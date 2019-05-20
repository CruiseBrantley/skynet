const { logger } = require("../bot");
const schedule = require('node-schedule');
const { botAnnounce } = require("./botAnnounce");

streamSchedule = () => {
	try {
		schedule.scheduleJob({ hour: 1, minute: 45, dayOfWeek: 3 }, botAnnounce());
		schedule.scheduleJob({ hour: 1, minute: 45, dayOfWeek: 4 }, botAnnounce());
		schedule.scheduleJob({ hour: 1, minute: 45, dayOfWeek: 5 }, botAnnounce());
		schedule.scheduleJob({ hour: 1, minute: 45, dayOfWeek: 6 }, botAnnounce());
		schedule.scheduleJob({ hour: 1, minute: 45, dayOfWeek: 0 }, botAnnounce());
	}
	catch (err) {
		logger.info("streamSchedule error:", err);
	}
}

exports.streamSchedule = streamSchedule;