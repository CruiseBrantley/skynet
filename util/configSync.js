const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const configPath = path.join(__dirname, '../config/announcements.json');

module.exports = function setupConfigSync(db) {
    const configRef = db.ref('twitch_announcements');

    // 1. Initial Sync: Pull from Firebase on startup
    configRef.once('value', snapshot => {
        if (snapshot.exists()) {
            const fbConfig = snapshot.val();
            fs.writeFileSync(configPath, JSON.stringify(fbConfig, null, 2));
            logger.info('Synced announcement config from Firebase.');
        } else {
            // Local to Firebase if Firebase is empty
            try {
                const localConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                configRef.set(localConfig);
                logger.info('Initialized Firebase with local announcement config.');
            } catch (err) {
                logger.error('Failed to initialize Firebase config:', err);
            }
        }
    });

    // 2. Watcher: Sync to local JSON if Firebase changes remotely
    // Note: This is disabled for now to avoid loops if we update via command,
    // but can be enabled if multiple bots share the same database.
    /*
    configRef.on('value', snapshot => {
        if (snapshot.exists()) {
            const data = JSON.stringify(snapshot.val(), null, 2);
            fs.writeFileSync(configPath, data);
            logger.info('Remote config update detected and synced to local JSON.');
        }
    });
    */

    return {
        updateRemote: (config) => {
            configRef.set(config)
                .then(() => logger.info('Successfully updated remote config in Firebase.'))
                .catch(err => logger.error('Failed to update remote config:', err));
        }
    };
};
