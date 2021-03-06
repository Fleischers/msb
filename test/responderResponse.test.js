/* Setup */
var expect = require('chai').expect;

/* Modules */
var simple = require('simple-mock');
var ResponderResponse = require('../lib/responderResponse');

describe('ResponderResponse', function() {
  var mockResponder;
  var response;

  describe('for a normal responder', function() {
    beforeEach(function(done) {
      mockResponder = {
        originalMessage: {
          payload: {}
        }
      };
      simple.mock(mockResponder, 'send');
      response = new ResponderResponse(mockResponder);
      done();
    });

    it('can be instantiated', function(done) {
      expect(response.responder).equals(mockResponder);
      expect(response.body).equals(null);
      done();
    });

    describe('end()', function() {
      it('can be called with a callback only', function(done) {
        mockResponder.send.callbackWith();

        response.end(function() {
          expect(mockResponder.send.called).to.be.true;
          expect(mockResponder.send.lastCall.args[0]).deep.equals({
            statusCode: response.statusCode,
            body: response.body
          });
          done();
        });
      });

      it('with pre-set body can be called with callback only', function(done) {
        mockResponder.send.callbackWith();

        response.body = {};

        response.end(function() {
          expect(mockResponder.send.called).to.be.true;
          expect(mockResponder.send.lastCall.args[0]).deep.equals({
            statusCode: response.statusCode,
            body: response.body
          });
          done();
        });
      });

      it('with pre-set body-less headers etc. can be called with callback only', function(done) {
        mockResponder.send.callbackWith();

        response.writeHead(204, {
          test: 'val'
        });
        response.body = 'overwriteMe';

        response.end(function() {
          expect(mockResponder.send.called).to.be.true;
          expect(mockResponder.send.lastCall.args[0]).deep.equals({
            statusCode: 204,
            body: null,
            headers: {
              test: 'val'
            }
          });
          done();
        });
      });

      it('can be called with buffer body', function(done) {
        mockResponder.send.callbackWith();

        response.body = 'overwriteMe';
        var newBody = new Buffer(20);
        newBody.fill();

        response.end(newBody, function() {
          expect(mockResponder.send.called).to.be.true;
          expect(mockResponder.send.lastCall.args[0]).deep.equals({
            statusCode: response.statusCode,
            body: null,
            bodyBuffer: 'AAAAAAAAAAAAAAAAAAAAAAAAAAA='
          });
          done();
        });
      });

      it('can be called with arbitrary body', function(done) {
        mockResponder.send.callbackWith();

        response.body = 'overwriteMe';
        var newBody = 'arb';

        response.end(newBody, function() {
          expect(mockResponder.send.called).to.be.true;
          expect(mockResponder.send.lastCall.args[0]).deep.equals({
            statusCode: response.statusCode,
            body: 'arb'
          });
          done();
        });
      });
    });
  });

  describe('where the request method is HEAD', function() {
    beforeEach(function(done) {
      mockResponder = {
        originalMessage: {
          payload: {
            method: 'HEAD'
          }
        }
      };
      simple.mock(mockResponder, 'send');
      response = new ResponderResponse(mockResponder);
      done();
    });

    describe('end()', function() {
      it('will send the payload without a body', function(done) {
        mockResponder.send.callbackWith();

        response.end('arb', function() {
          expect(mockResponder.send.called).to.be.true;
          expect(mockResponder.send.lastCall.args[0]).deep.equals({
            statusCode: response.statusCode,
            body: null
          });
          done();
        });
      });
    });
  });
});
