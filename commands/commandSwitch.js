function chatCommand (command) {
  switch (command.cmd) {
    case 'ping':
      command.ping()
      break
    case 'mmr':
      command.mmr()
      break
    case 'speak':
      command.speak()
      break
    case 'yt':
    case 'youtube':
      command.youtube()
      break
    case 'searchyoutube':
    case 'search':
      command.searchyoutube()
      break
    case 'ytpl':
      command.youtubeplaylist()
      break
    case 'v':
    case 'volume':
      command.volume()
      break
    case 'stop':
      command.stop()
      break
    case 'pause':
      command.pause()
      break
    case 'resume':
      command.resume()
      break
    case 'server':
      command.server()
      break
    case 'say':
      command.say()
      break
    case 'note':
      command.note()
      break
    case 'listnotes':
    case 'ln':
      command.listnotes()
      break
    case 'catfact':
      command.catfact()
      break
    case 'setsession':
      command.setsession()
      break
    case 'session':
      command.session()
      break
    case 'vote':
    case 'votes':
      command.vote()
      break
    case 'unvote':
      command.unvote()
      break
    case 'votereset':
    case 'resetvotes':
      command.votereset()
      break
    case 'voteadd':
      command.voteadd()
      break
    case 'voteremove':
      command.voteremove()
      break
    case 'voteclear':
      command.voteclear()
      break
    case 'time':
      command.time()
      break
    case 'whi':
    case 'wafflehouse':
    case 'wafflehouseindex':
      command.wafflehouse()
  }
}
module.exports = chatCommand
