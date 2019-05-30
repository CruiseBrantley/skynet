const { logger } = require("../bot");
const schedule = require('node-schedule');
const { botAnnounce } = require("./botAnnounce");

streamSchedule = () => {
	try {
		schedule.scheduleJob({ hour: 11, minute: 00, dayOfWeek: 2 }, botAnnounce());
		schedule.scheduleJob({ hour: 11, minute: 00, dayOfWeek: 3 }, botAnnounce());
		schedule.scheduleJob({ hour: 11, minute: 00, dayOfWeek: 4 }, botAnnounce());
		schedule.scheduleJob({ hour: 11, minute: 00, dayOfWeek: 5 }, botAnnounce());
		schedule.scheduleJob({ hour: 11, minute: 00, dayOfWeek: 6 }, botAnnounce());
	}
	catch (err) {
		logger.info("streamSchedule error:", err);
	}
}

exports.streamSchedule = streamSchedule;