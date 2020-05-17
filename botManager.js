const discordBot = require('./bot')
const cluster = require('cluster')

if (cluster.isMaster) {
  cluster.fork()

  cluster.on('exit', function (worker, code, signal) {
    cluster.fork()
  })
}

if (cluster.isWorker) {
  discordBot()
}
