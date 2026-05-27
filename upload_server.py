#!/usr/bin/env python3
"""
upload_server.py
简易文件上传服务器（Flask）
接收 POST /upload 上传的文件，保存到 SAVE_DIR
运行:  python upload_server.py
默认端口: 8001
"""
import os
import sys
from flask import Flask, request, jsonify

# ============ 配置 ============
SAVE_DIR = r"D:\official_project\001_recognize&train\data_storage"
PORT = 8001
# ==============================

app = Flask(__name__)

@app.route('/upload', methods=['POST'])
def upload_file():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400

        # 确保保存目录存在
        os.makedirs(SAVE_DIR, exist_ok=True)

        save_path = os.path.join(SAVE_DIR, file.filename)
        file.save(save_path)
        print(f"[UploadServer] 已保存: {save_path}")
        return jsonify({'success': True, 'filename': file.filename, 'path': save_path})
    except Exception as e:
        print(f"[UploadServer] 错误: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/', methods=['GET'])
def index():
    return '''
    <!doctype html>
    <html>
    <head><meta charset="utf-8"><title>上传测试</title></head>
    <body>
      <h2>上传测试</h2>
      <form method="post" enctype="multipart/form-data" action="/upload">
        <input type="file" name="file">
        <button type="submit">上传</button>
      </form>
    </body>
    </html>
    '''

if __name__ == '__main__':
    print(f"[UploadServer] 启动于 http://0.0.0.0:{PORT}")
    print(f"[UploadServer] 文件保存目录: {SAVE_DIR}")
    app.run(host='0.0.0.0', port=PORT, debug=False)
