const admin = require('firebase-admin')
const serviceAccount = require('./service-account.json')

module.exports = function firebaseLogin () {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://skynet-voting.firebaseio.com'
  })

  return admin.database()
}
/*
db.ref('525112230006489091').once('value', snapshot => {
    console.log(snapshot.val())
})
let ref = db.ref('112')
ref.set([{ newArray: 1311, secondArray: 1111 }])
ref.set([{ newArray: 1333, secondArray: 2222 }])

ref.on(
    'value',
    snapshot => console.log(snapshot.val()),
    errorObject => console.log('The read failed: ' + errorObject.code)
)
*/
