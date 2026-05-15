/**
 * generate_test_data.js
 * 生成模拟实验数据，写入 experiment_history.json
 * 运行：node generate_test_data.js
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'experiment_history.json');

// 确保 data 目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const PHASES = ['pre', 'train', 'post'];
const FUNCS = [1, 2, 3, 4];
const GENDERS = ['male', 'female'];
const SNR_MODES = ['adaptive', 'fixed'];

function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function formatDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function generateResults(func, trialCount = 30) {
  const results = [];
  for (let i = 1; i <= trialCount; i++) {
    const trial = {
      trial: i,
      snr: parseFloat(randomInRange(-12, 9).toFixed(1)),
      blur: func === 2 || func === 3 ? parseFloat(randomInRange(0, 100).toFixed(0)) : 0,
      soa: func === 3 ? parseInt(randomInRange(-300, 300)) : 0,
      attention: func === 4 ? (Math.random() > 0.5 ? 'dual' : 'single') : 'dual',
      correct: Math.random() > 0.3,
      rt: parseInt(randomInRange(300, 2000)),
      choice: ['ba', 'da', 'ga'][Math.floor(Math.random() * 3)],
      timestamp: new Date().toISOString()
    };
    results.push(trial);
  }
  return results;
}

function generatePsychometricFit(func) {
  if (func === 1) {
    return {
      alpha: parseFloat(randomInRange(-6, 3).toFixed(4)),
      beta: parseFloat(randomInRange(0.5, 3).toFixed(4)),
      gamma: 0.25,
      lambda: 0.02,
      threshold: parseFloat(randomInRange(-9, 6).toFixed(2)),
      criterion: 0.80,
      r2: parseFloat(randomInRange(0.7, 0.99).toFixed(4)),
      nll: parseFloat(randomInRange(10, 50).toFixed(2))
    };
  }
  return null;
}

// 生成模拟数据
const allData = [];
const SUBJECTS = ['S001', 'S002', 'S003', 'S005', 'S010']; // 5 个被试

SUBJECTS.forEach((subjectId, idx) => {
  const gender = GENDERS[idx % 2];
  const age = 20 + parseInt(Math.random() * 40); // 20-60 岁

  PHASES.forEach(phase => {
    FUNCS.forEach(func => {
      // 每个 (phase, func) 生成 1-2 条记录（模拟多次尝试）
      const attemptCount = 1 + Math.floor(Math.random() * 2);
      for (let attempt = 1; attempt <= attemptCount; attempt++) {
        const results = generateResults(func, 30);
        const fitResult = generatePsychometricFit(func);
        const threshold = fitResult ? fitResult.threshold : null;

        const isActive = attempt === attemptCount; // 最后一次尝试为 active
        const groupKey = `${subjectId}_${phase}_func${func}`;

        const record = {
          id: generateId(),
          attemptNumber: attempt,
          groupKey: groupKey,
          status: isActive ? 'active' : 'overwritten',
          overwrittenBy: isActive ? null : 'future_id_placeholder',
          previousAttemptId: attempt > 1 ? 'prev_id_placeholder' : null,
          timestamp: new Date(Date.now() - Math.floor(Math.random() * 30 * 24 * 3600 * 1000)).toISOString(),
          metadata: {
            subjectId,
            gender,
            age,
            date: formatDate(-Math.floor(Math.random() * 30)),
            phase,
            func,
            attemptNumber: attempt,
            snrMode: SNR_MODES[Math.floor(Math.random() * 2)],
            threshold,
            totalTrials: results.length,
            accuracy: parseFloat((results.filter(r => r.correct).length / results.length * 100).toFixed(0)),
            avgRT: parseInt(results.filter(r => r.rt < 10000).reduce((a, b) => a + b.rt, 0) / results.filter(r => r.rt < 10000).length)
          },
          psychometricFit: fitResult,
          rawEventLog: null,
          results
        };

        allData.push(record);
      }
    });
  });
});

// 整理 overwrittenBy 和 previousAttemptId
const recordMap = {};
allData.forEach(d => { recordMap[d.id] = d; });

// 按 groupKey 分组，排序，设置 overwrittenBy 和 previousAttemptId
const groups = {};
allData.forEach(d => {
  if (!groups[d.groupKey]) groups[d.groupKey] = [];
  groups[d.groupKey].push(d);
});
Object.values(groups).forEach(group => {
  group.sort((a, b) => a.attemptNumber - b.attemptNumber);
  for (let i = 0; i < group.length; i++) {
    if (i > 0) group[i].previousAttemptId = group[i - 1].id;
    if (i < group.length - 1) group[i].overwrittenBy = group[i + 1].id;
  }
});

// 写入文件
fs.writeFileSync(DATA_FILE, JSON.stringify(allData, null, 2), 'utf8');
console.log(`✅ 已生成 ${allData.length} 条模拟记录，写入 ${DATA_FILE}`);
console.log(`   被试：${SUBJECTS.join(', ')}`);
console.log(`   阶段：pre / train / post`);
console.log(`   功能：1-4`);
console.log(`   数据文件大小：${(fs.statSync(DATA_FILE).size / 1024).toFixed(1)} KB`);
