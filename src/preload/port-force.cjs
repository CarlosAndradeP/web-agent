const net = require('net');

const forcedPort = parseInt(process.env.PORT, 10);

if (forcedPort && forcedPort > 0) {
  const originalListen = net.Server.prototype.listen;

  net.Server.prototype.listen = function (...args) {
    if (typeof args[0] === 'number') {
      args[0] = forcedPort;
    } else if (args[0] && typeof args[0] === 'object' && 'port' in args[0]) {
      args[0] = { ...args[0], port: forcedPort };
    } else if (typeof args[0] === 'string' && args[0].match(/^:\d+$/) ) {
      args[0] = ':' + forcedPort;
    }

    if (typeof args[1] === 'number') {
      args[1] = forcedPort;
    } else if (args[1] && typeof args[1] === 'object' && 'port' in args[1]) {
      args[1] = { ...args[1], port: forcedPort };
    }

    return originalListen.apply(this, args);
  };
}
