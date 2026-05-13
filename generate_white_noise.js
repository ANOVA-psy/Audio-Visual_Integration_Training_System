/**
 * 白噪音生成脚本
 * 在浏览器控制台运行此脚本，会下载一个 white_noise.wav 文件
 * 
 * 使用方法：
 * 1. 在浏览器中打开 index.html
 * 2. 按 F12 打开开发者工具
 * 3. 复制粘贴此脚本到控制台
 * 4. 按回车执行，会自动下载 white_noise.wav
 */

(function generateWhiteNoise() {
  const sampleRate = 44100;
  const duration = 5; // 5秒
  const numSamples = sampleRate * duration;
  
  // 创建 WAV 文件
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  
  // WAV 文件头
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, numSamples * 2, true);
  
  // 生成白噪音样本
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.random() * 2 - 1;
    view.setInt16(44 + i * 2, sample * 0x7FFF, true);
  }
  
  // 下载文件
  const blob = new Blob([buffer], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'white_noise.wav';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  console.log('✅ 白噪音文件已生成并下载：white_noise.wav');
  console.log('请将此文件放置到：assets/audio/white_noise.wav');
  
  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
})();
