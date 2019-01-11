/* eslint-disable no-console */

'use strict';

var agentPort = process.env.AGENT_PORT;

require('../../../../')({
  agentPort: agentPort,
  level: 'warn',
  tracing: {
    enabled: process.env.TRACING_ENABLED === 'true',
    forceTransmissionStartingAt: 1
  }
});

var path = require('path');

var STATIC = !!process.env.GRPC_STATIC;
var PACKAGE_VERSION = process.env.GRPC_PACKAGE_VERSION || '=1.10.1';
var PROTO_PATH = path.join(__dirname, 'protos/helloworld.proto');

var server;

// function onExit(callProcessExit) {
//   console.log('cleaning up');
//   if (server) {
//     server.forceShutdown();
//   }
//   if (callProcessExit) {
//     process.exit();
//   }
// }
//
// process.on('exit', onExit.bind(null, false));
// process.on('SIGINT', onExit.bind(null, true));
// process.on('SIGUSR1', onExit.bind(null, true));
// process.on('SIGUSR2', onExit.bind(null, true));
// process.on('uncaughtException', onExit.bind(null, true));

switch (PACKAGE_VERSION) {
  case '=1.10.1':
    if (STATIC) {
      runStaticLegacyServer();
    } else {
      runDynamicLegacyServer();
    }
    break;
  case '>=1.17.0':
    if (STATIC) {
      runStaticModernServer();
    } else {
      runDynamicModernServer();
    }
    break;
  default:
    throw new Error('Unsupported API version: ' + PACKAGE_VERSION);
}

/**
 * grpc@1.10.1, static codegen
 */
function runStaticLegacyServer() {
  log('Running static legacy GRPC server.');

  var messages = require('./helloworld_pb');
  var services = require('./helloworld_grpc_pb');

  var grpc = require('grpc');

  /**
   * Implements the SayHello RPC method.
   */
  function sayHello(call, callback) {
    var reply = new messages.HelloReply();
    reply.setMessage('Hello ' + call.request.getName());
    callback(null, reply);
  }

  /**
   * Starts an RPC server that receives requests for the Greeter service at the
   * sample server port
   */
  function main() {
    server = new grpc.Server();
    server.addService(services.GreeterService, { sayHello: sayHello });
    server.bind('0.0.0.0:50051', grpc.ServerCredentials.createInsecure());
    server.start();
  }

  main();
}

/**
 * grpc@1.10.1, dynamic codegen
 */
function runDynamicLegacyServer() {
  log('Running dynamic legacy GRPC server.');

  var grpc = require('grpc');
  var helloProto = grpc.load(PROTO_PATH).helloworld;

  /**
   * Implements the SayHello RPC method.
   */
  function sayHello(call, callback) {
    callback(null, { message: 'Hello ' + call.request.name });
  }

  /**
   * Starts an RPC server that receives requests for the Greeter service at the
   * sample server port
   */
  function main() {
    server = new grpc.Server();
    server.addService(helloProto.Greeter.service, { sayHello: sayHello });
    server.bind('0.0.0.0:50051', grpc.ServerCredentials.createInsecure());
    server.start();
  }

  main();
}

/**
 * grpc@^1.17.0, static codegen
 */
function runStaticModernServer() {
  log('Running static modern GRPC server.');

  var messages = require('./helloworld_pb');
  var services = require('./helloworld_grpc_pb');

  var grpc = require('grpc');

  /**
   * Implements the SayHello RPC method.
   */
  function sayHello(call, callback) {
    var reply = new messages.HelloReply();
    reply.setMessage('Hello ' + call.request.getName());
    callback(null, reply);
  }

  /**
   * Starts an RPC server that receives requests for the Greeter service at the
   * sample server port
   */
  function main() {
    server = new grpc.Server();
    server.addService(services.GreeterService, { sayHello: sayHello });
    server.bind('0.0.0.0:50051', grpc.ServerCredentials.createInsecure());
    server.start();
  }

  main();
}

/**
 * grpc@^1.17.0, dynamic codegen
 */
function runDynamicModernServer() {
  log('Running dynamic modern GRPC server.');

  var grpc = require('grpc');
  var protoLoader = require('@grpc/proto-loader');
  var packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });
  var helloProto = grpc.loadPackageDefinition(packageDefinition).helloworld;

  /**
   * Implements the SayHello RPC method.
   */
  function sayHello(call, callback) {
    callback(null, { message: 'Hello ' + call.request.name });
  }

  /**
   * Starts an RPC server that receives requests for the Greeter service at the
   * sample server port
   */
  function main() {
    server = new grpc.Server();
    server.addService(helloProto.Greeter.service, { sayHello: sayHello });
    server.bind('0.0.0.0:50051', grpc.ServerCredentials.createInsecure());
    server.start();
  }

  main();
}

function log() {
  var args = Array.prototype.slice.call(arguments);
  args[0] = 'GRPC Server (' + process.pid + '):\t' + args[0];
  console.log.apply(console, args);
}
