const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 静态文件服务（用于访问实验界面）
app.use(express.static(__dirname));

// 确保 data 目录存在
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

async function ensureDirectories() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    console.log('Data directories created/confirmed');
  } catch (err) {
    console.error('Create directory failed:', err);
  }
}

// ==================== API Endpoints ====================

// 上传接口（兼容旧版客户端）
app.post('/upload', async (req, res) => {
  try {
    const newData = req.body;
    const dataFile = path.join(DATA_DIR, 'experiment_history.json');
    
    let existingData = [];
    try {
      const content = await fs.readFile(dataFile, 'utf8');
      existingData = JSON.parse(content || '[]');
    } catch (e) {
      existingData = [];
    }
    
    existingData.push(newData);
    await fs.writeFile(dataFile, JSON.stringify(existingData, null, 2));
    
    console.log('Data uploaded:', newData.id || 'unknown');
    res.json({ success: true, id: newData.id });
  } catch (err) {
    console.error('Upload failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// 上传文件（用于上传音频、视频等文件）
app.post('/upload/file', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
  try {
    const filename = req.query.filename || `upload_${Date.now()}`;
    const filePath = path.join(UPLOADS_DIR, filename);
    
    await fs.writeFile(filePath, req.body);
    
    console.log('File uploaded:', filename);
    res.json({ success: true, filename, path: `/data/uploads/${filename}` });
  } catch (err) {
    console.error('File upload failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// 获取所有数据
app.get('/api/data', async (req, res) => {
  try {
    const dataFile = path.join(DATA_DIR, 'experiment_history.json');
    let data = [];
    try {
      const content = await fs.readFile(dataFile, 'utf8');
      data = JSON.parse(content || '[]');
    } catch (e) {
      data = [];
    }
    res.json(data);
  } catch (err) {
    console.error('Read data failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// 保存数据（接收完整记录）
app.post('/api/data', async (req, res) => {
  try {
    const newData = req.body;
    const dataFile = path.join(DATA_DIR, 'experiment_history.json');
    
    let existingData = [];
    try {
      const content = await fs.readFile(dataFile, 'utf8');
      existingData = JSON.parse(content || '[]');
    } catch (e) {
      existingData = [];
    }
    
    existingData.push(newData);
    await fs.writeFile(dataFile, JSON.stringify(existingData, null, 2));
    
    console.log('Data saved:', newData.id);
    res.json({ success: true, id: newData.id });
  } catch (err) {
    console.error('Save data failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// 删除数据
app.delete('/api/data/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const dataFile = path.join(DATA_DIR, 'experiment_history.json');
    
    let existingData = [];
    try {
      const content = await fs.readFile(dataFile, 'utf8');
      existingData = JSON.parse(content || '[]');
    } catch (e) {
      existingData = [];
    }
    
    const filtered = existingData.filter(d => d.id !== id);
    await fs.writeFile(dataFile, JSON.stringify(filtered, null, 2));
    
    console.log('Data deleted:', id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete data failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// 列出所有数据文件
app.get('/api/files', async (req, res) => {
  try {
    const files = await fs.readdir(DATA_DIR);
    const fileStats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(DATA_DIR, file);
        const stats = await fs.stat(filePath);
        return {
          name: file,
          size: stats.size,
          modified: stats.mtime
        };
      })
    );
    res.json(fileStats);
  } catch (err) {
    console.error('List files failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== Start Server ====================

async function startServer() {
  await ensureDirectories();
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('Server started successfully!');
    console.log('');
    console.log('Local access URLs:');
    console.log(`  http://localhost:${PORT}`);
    console.log(`  http://127.0.0.1:${PORT}`);
    console.log('');
    console.log('Waiting for ngrok to start...');
    console.log('');
  });
}

startServer();
