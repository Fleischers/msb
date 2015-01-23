var EventEmitter = require('events').EventEmitter;
var _ = require('lodash');
var debug = require('debug')('msb:channelMonitor');
var messageFactory = require('./messageFactory');
var channelManager = require('./channelManager');
var Originator = require('./originator');
var Contributor = require('./contributor');

var channelMonitor = module.exports = new EventEmitter();
var announcementProducer;
var announcementConsumer;
var heartbeatContributorListener;
var doHeartbeatInterval;
var doHeartbeatOriginator;
var collectingInfoByTopic;

channelMonitor.config = {
  announceOnTopic: '_channels:announce',
  heartbeatsOnTopic: '_channels:heartbeat',
  heartbeatTimeoutMs: 5000, // Time to respond to heartbeat (must be < heartbeatIntervalMs)
  heartbeatIntervalMs: 10000, // Time before next heartbeat (must be > heartbeatTimeoutMs)
};

channelMonitor.infoByTopic = {};
channelMonitor.localInfoByTopic = {};

channelMonitor.startBroadcasting = function() {
  if (heartbeatContributorListener) return;

  heartbeatContributorListener = Contributor.attachListener({
    namespace: channelMonitor.config.heartbeatsOnTopic
  }, function(contributor) {
    contributor.message.res.infoByTopic = channelMonitor.localInfoByTopic;
    contributor.send();
  });

  channelManager
  .on(channelManager.PRODUCER_NEW_TOPIC_EVENT, onChannelManagerProducerNewTopic)
  .on(channelManager.CONSUMER_NEW_TOPIC_EVENT, onChannelManagerConsumerNewTopic)
  .on(channelManager.CONSUMER_NEW_MESSAGE_EVENT, onChannelManagerConsumerNewMessage);
};

channelMonitor.stopBroadcasting = function() {
  if (!heartbeatContributorListener) return; // Not broadcasting

  heartbeatContributorListener.end();
  heartbeatContributorListener = null;

  channelManager
  .removeListener(channelManager.PRODUCER_NEW_TOPIC_EVENT, onChannelManagerProducerNewTopic)
  .removeListener(channelManager.CONSUMER_NEW_TOPIC_EVENT, onChannelManagerConsumerNewTopic)
  .removeListener(channelManager.CONSUMER_NEW_MESSAGE_EVENT, onChannelManagerConsumerNewMessage);
};

channelMonitor.doBroadcast = function() {
  var announceOnTopic = channelMonitor.config.announceOnTopic;
  if (!announcementProducer) announcementProducer = channelManager.createProducer(announceOnTopic);

  var message = messageFactory.createBaseMessage({
    namespace: announceOnTopic
  });

  message.res.infoByTopic = channelMonitor.localInfoByTopic;
  messageFactory.completeMeta(message, messageFactory.createMeta());
  announcementProducer.publish(message, noop);
};

channelMonitor.startMonitoring = function() {
  if (announcementConsumer) return; // Already monitoring

  var announceOnTopic = channelMonitor.config.announceOnTopic;
  announcementConsumer = channelManager.createConsumer(announceOnTopic);
  announcementConsumer.on('message', onAnnouncementMessage);

  if (!channelMonitor.config.heartbeatIntervalMs) return; // Monitor without heartbeat
  channelMonitor.doHeartbeat();
  doHeartbeatInterval = setInterval(channelMonitor.doHeartbeat, channelMonitor.config.heartbeatIntervalMs);
};

channelMonitor.stopMonitoring = function() {
  if (!announcementConsumer) return; // Not monitoring

  announcementConsumer.removeListener('message', onAnnouncementMessage);
  announcementConsumer = null;

  // Monitoring with heartbeat
  if (doHeartbeatOriginator) {
    doHeartbeatOriginator.removeListeners();
    clearInterval(doHeartbeatInterval);
  }
};

channelMonitor.doHeartbeat = function() {
  collectingInfoByTopic = {};

  var originator = new Originator({
    namespace: channelMonitor.config.heartbeatsOnTopic,
    contribTimeout: channelMonitor.config.heartbeatTimeoutMs
  });
  doHeartbeatOriginator = originator; // To be able to cancel

  originator.on('contrib', function(message) {
    aggregateChannelInfo(collectingInfoByTopic, message.res.infoByTopic, message.meta.serviceDetails.instanceId);
  });

  originator.on('end', function() {
    channelMonitor.infoByTopic = collectingInfoByTopic;
    doHeartbeatOriginator = null;

    channelMonitor.emit('updated', channelMonitor.infoByTopic);
    debug(JSON.stringify(sortedObject(channelMonitor.infoByTopic), null, '  '));
  });

  originator.message.res.infoByTopic = collectingInfoByTopic;
  originator.publish();
};

function onChannelManagerProducerNewTopic(topic) {
  if (topic[0] === '_') return;
  findOrCreateChannelInfo(channelMonitor.localInfoByTopic, topic, true).producers = true;
  channelMonitor.doBroadcast();
}

function onChannelManagerConsumerNewTopic(topic) {
  if (topic[0] === '_') return;
  findOrCreateChannelInfo(channelMonitor.localInfoByTopic, topic, true).consumers = true;
  channelMonitor.doBroadcast();
}

function onChannelManagerConsumerNewMessage(topic) {
  if (topic[0] === '_') return;
  findOrCreateChannelInfo(channelMonitor.localInfoByTopic, topic, true).lastConsumedAt = new Date();
}

function onAnnouncementMessage(message) {
  var remoteId = message.meta.serviceDetails.instanceId;
  var remoteInfoByTopic = message.res.infoByTopic;

  aggregateChannelInfo(channelMonitor.infoByTopic, remoteInfoByTopic, remoteId);

  if (collectingInfoByTopic) {
    aggregateChannelInfo(collectingInfoByTopic, remoteInfoByTopic, remoteId);
  }

  channelMonitor.emit('updated', channelMonitor.infoByTopic);
  debug(JSON.stringify(sortedObject(channelMonitor.infoByTopic), null, '  '));
}

function aggregateChannelInfo(infoByTopic, remoteInfoByTopic, remoteId) {
  for (var i in Object.keys(remoteInfoByTopic)) {
    var topic = Object.keys(remoteInfoByTopic)[i];
    var channelInfo = findOrCreateChannelInfo(infoByTopic, topic);
    var remoteChannelInfo = remoteInfoByTopic[topic];

    if (remoteChannelInfo.producers && !~channelInfo.producers.indexOf(remoteId)) {
      channelInfo.producers.push(remoteId);
    }

    if (remoteChannelInfo.consumers && !~channelInfo.consumers.indexOf(remoteId)) {
      channelInfo.consumers.push(remoteId);
    }

    channelInfo.lastConsumedAt = maxDateAndString(channelInfo.lastConsumedAt, remoteChannelInfo.lastConsumedAt);
  }
}

function maxDateAndString(defaultDate, newDateString) {
  if (!newDateString) return defaultDate;

  var newDate = new Date(newDateString);
  if (!defaultDate) return newDate;

  return new Date(Math.max(defaultDate, newDate));
}

function findOrCreateChannelInfo(channelInfoPerTopic, topic, isLocal) {
  var channelInfo = channelInfoPerTopic[topic];
  if (channelInfo) return channelInfo;

  channelInfo = channelInfoPerTopic[topic] = {
    producers: (isLocal) ? false : [],
    consumers: (isLocal) ? false : [],
    lastConsumedAt: null
  };
  return channelInfo;
}

function sortedObject(obj) {
  var args = Object.keys(obj).sort();
  args.unshift(obj);
  return _.pick.apply(null, args);
}

function noop() {}