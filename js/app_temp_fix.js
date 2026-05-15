// 临时文件，用于修复语法错误
// 正确的EventLogger.user调用应该是：
// EventLogger.user('click_play', {
//   trial: STATE.currentTrialIndex + 1,
//   snr: trial.snr,
//   blur: trial.blur,
//   soa: trial.soa,
//   attention: trial.attention
// });
