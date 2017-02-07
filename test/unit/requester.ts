import {expect} from "chai";
import * as messageFactory from "../../lib/messageFactory";
const channelManager = require("../../lib/channelManager").default;
import {Requester} from "../../lib/requester";
const simple = require("simple-mock");

describe("Requester", function() {

  afterEach(function(done) {
    simple.restore();
    done();
  });

  it("can be initialized", function(done) {
    simple.mock(messageFactory, "createRequestMessage");

    const obj = new Requester({});

    expect((messageFactory.createRequestMessage as any).called).to.equal(true);
    done();
  });

  describe("publish()", function() {
    let producer;

    beforeEach(function(done) {
      producer = {};

      simple.mock(producer, "publish");
      simple.mock(channelManager, "findOrCreateProducer", function(topic) {
        return producer;
      });

      done();
    });

    it("can emit error", function(done) {
      const errHandler = simple.mock();
      const expectedErr = new Error();
      producer.publish.callbackWith(expectedErr);

      const obj = new Requester({
        waitForResponses: 0,
      });

      obj
      .on("error", errHandler)
      .publish({});

      expect(producer.publish.called).to.equal(true);
      expect(errHandler.called).to.equal(true);
      expect(errHandler.lastCall.args[0]).to.equal(expectedErr);

      done();
    });

    it("can emit message immediately", function(done) {
      producer.publish.callbackWith();

      const endHandler = simple.mock();

      const obj = new Requester({
        waitForResponses: 0,
      });

      obj
      .on("end", endHandler)
      .publish({});

      expect(producer.publish.called).to.equal(true);
      expect(endHandler.called).to.equal(true);

      done();
    });

    it("can start collecting responses", function(done) {
      producer.publish.callbackWith();

      const endHandler = simple.mock();

      const obj = new Requester({
        waitForResponses: 1,
      });

      const bindMock = simple.mock(obj.shouldAcceptMessageFn, "bind").returnWith("testValue");
      simple.mock(obj, "listenForResponses").returnWith();

      obj
      .on("end", endHandler)
      .publish({});

      expect(bindMock.lastCall.args[0]).to.equal(obj);
      expect((obj.listenForResponses as any).lastCall.args[0]).to.equal(obj.message.topics.response);
      expect((obj.listenForResponses as any).lastCall.args[1]).to.equal("testValue");
      expect(producer.publish.called).to.equal(true);
      expect(endHandler.called).to.equal(false);

      done();
    });

    it("can wait for acks without any determined number of responses", function(done) {
      producer.publish.callbackWith();

      const endHandler = simple.mock();

      const obj = new Requester({
        waitForResponses: 0,
        waitForAcksMs: 800,
      });

      const bindMock = simple.mock(obj.shouldAcceptMessageFn, "bind").returnWith("testValue");
      simple.mock(obj, "listenForResponses").returnWith();
      simple.mock(obj, "isAwaitingAcks").returnWith(true);

      obj
      .on("end", endHandler)
      .publish({});

      expect(bindMock.lastCall.args[0]).to.equal(obj);
      expect((obj.listenForResponses as any).lastCall.args[0]).to.equal(obj.message.topics.response);
      expect((obj.listenForResponses as any).lastCall.args[1]).to.equal("testValue");
      expect(producer.publish.called).to.equal(true);
      expect(endHandler.called).to.equal(false);

      done();
    });
  });

  describe("shouldAcceptMessageFn()", function() {

    it("should per default match on message id", function(done) {
      const obj = new Requester({});

      expect(obj.shouldAcceptMessageFn({
        id: "id",
        tags: [],
        correlationId: obj.message.correlationId,
        topics: {},
      })).to.be.true;

      expect(obj.shouldAcceptMessageFn({
        id: "id",
        correlationId: "other",
        tags: [],
        topics: {},
      })).to.be.false;

      done();
    });

  });
});