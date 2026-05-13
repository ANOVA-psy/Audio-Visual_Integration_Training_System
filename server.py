#!/usr/bin/env python3
"""
HTTP 服务器，带 CORS 支持 + MIME 类型修正
解决 file:// 协议的 CORS 限制问题
用法: python server.py [port]
"""

import http.server
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

class CORSHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """带 CORS 支持的 HTTP 请求处理器"""
    
    def end_headers(self):
        self.send_cors_headers()
        super().end_headers()
    
    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
        self.send_header("Access-Control-Expose-Headers", "Content-Range, Content-Length")
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()
    
    def guess_type(self, path):
        """修正 MIME 类型"""
        mime = super().guess_type(path)
        # 确保 MP4 视频有正确的 MIME 类型
        if path.endswith('.mp4'):
            return 'video/mp4'
        if path.endswith('.m4a'):
            return 'audio/mp4'
        if path.endswith('.wav'):
            return 'audio/wav'
        return mime
    
    def log_message(self, format, *args):
        """自定义日志格式"""
        sys.stderr.write(
            f"[{self.log_date_time_string()}] {args[0]} {args[1]} {args[2]}\n"
        )

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    with socketserver.TCPServer(("", PORT), CORSHTTPRequestHandler) as httpd:
        print(f"✓ 服务器启动成功")
        print(f"  本地访问: http://localhost:{PORT}/")
        print(f"  CORS: 已启用 (Access-Control-Allow-Origin: *)")
        print(f"  按 Ctrl+C 停止")
        print("-" * 50)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n✓ 服务器已停止")
