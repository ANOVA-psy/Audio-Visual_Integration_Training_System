#!/usr/bin/env python3
"""
启动脚本：启动服务器和 ngrok，显示访问地址
使用方法：双击运行或在命令行运行

修复内容：
1. 启动前先杀掉占用端口的进程（3000、4040）
2. 测试 ngrok 公网页面是否能正常打开
3. 移除对 .bat 文件的依赖，直接使用 Python
"""

import os
import sys
import time
import json
import subprocess
import urllib.request
import urllib.error
import socket
import signal

# 项目目录（脚本所在目录）
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(PROJECT_DIR)

def is_port_in_use(port):
    """检查端口是否被占用"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result = sock.connect_ex(('localhost', port))
        sock.close()
        return result == 0
    except:
        return False

def kill_port(port):
    """杀掉占用指定端口的进程（Windows）"""
    try:
        # 查找占用端口的进程
        result = subprocess.run(
            ['netstat', '-ano'],
            capture_output=True,
            text=True,
            encoding='gbk',
            errors='ignore'
        )
        
        if result.returncode == 0:
            lines = result.stdout.split('\n')
            for line in lines:
                if f':{port}' in line and 'LISTENING' in line:
                    parts = line.split()
                    if len(parts) >= 5:
                        pid = parts[-1]
                        print(f"   🔍 发现端口 {port} 被进程 {pid} 占用")
                        
                        # 杀掉进程
                        kill_result = subprocess.run(
                            ['taskkill', '/F', '/PID', pid],
                            capture_output=True,
                            text=True,
                            encoding='gbk',
                            errors='ignore'
                        )
                        
                        if kill_result.returncode == 0:
                            print(f"   ✅ 已杀掉进程 {pid}")
                            return True
                        else:
                            print(f"   ⚠️ 无法杀掉进程 {pid}")
        
        return False
    except Exception as e:
        print(f"   ⚠️ 清理端口 {port} 失败: {e}")
        return False

def print_step(step, total, message, status=None):
    """打印步骤信息"""
    if status == "成功":
        prefix = "✅"
    elif status == "失败":
        prefix = "❌"
    elif status == "警告":
        prefix = "⚠️"
    elif status == "提示":
        prefix = "💡"
    else:
        prefix = f"[{step}/{total}]"
    
    print(f"{prefix} {message}")

def check_node_js():
    """检查 Node.js 是否安装"""
    try:
        result = subprocess.run(
            ['node', '--version'],
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='ignore'
        )
        if result.returncode == 0:
            version = result.stdout.strip()
            print_step(1, 5, f"Node.js 已安装（{version}）", "成功")
            return True
        else:
            print_step(1, 5, "未找到 Node.js，请先安装：https://nodejs.org/", "失败")
            return False
    except Exception as e:
        print_step(1, 5, f"未找到 Node.js：{e}", "失败")
        return False

def check_ngrok():
    """检查 ngrok 是否安装"""
    try:
        result = subprocess.run(
            ['ngrok', 'version'],
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='ignore'
        )
        if result.returncode == 0:
            version = result.stdout.strip().split('\n')[0]
            print_step(2, 5, f"ngrok 已安装（{version}）", "成功")
            return True
        else:
            print_step(2, 5, "未找到 ngrok，请先安装：https://ngrok.com/download", "失败")
            return False
    except Exception as e:
        print_step(2, 5, f"未找到 ngrok：{e}", "失败")
        return False

def check_dependencies():
    """检查 Node.js 依赖"""
    if not os.path.exists(os.path.join(PROJECT_DIR, 'node_modules')):
        print_step(2, 5, "正在安装依赖（首次运行）...", "提示")
        try:
            result = subprocess.run(
                ['npm', 'install'],
                capture_output=True,
                text=True,
                encoding='utf-8',
                errors='ignore'
            )
            if result.returncode == 0:
                print_step(2, 5, "依赖安装完成", "成功")
                return True
            else:
                print_step(2, 5, f"依赖安装失败：{result.stderr}", "失败")
                return False
        except Exception as e:
            print_step(2, 5, f"依赖安装失败：{e}", "失败")
            return False
    else:
        print_step(2, 5, "依赖已就绪", "成功")
        return True

def cleanup_ports():
    """清理占用的端口"""
    print_step(2, 5, "正在清理端口...", "提示")
    
    ports = [3000, 4040]
    for port in ports:
        if is_port_in_use(port):
            print(f"   🔍 端口 {port} 已被占用，尝试清理...")
            kill_port(port)
            time.sleep(1)
        else:
            print(f"   ✅ 端口 {port} 可用")
    
    print_step(2, 5, "端口清理完成", "成功")

def start_server():
    """启动 Node.js 服务器"""
    if is_port_in_use(3000):
        print_step(3, 5, "服务器已在运行（端口 3000 被占用）", "提示")
        return True
    
    print_step(3, 5, "正在启动服务器（端口 3000）...", "提示")
    
    try:
        # 启动服务器（不显示窗口）
        if os.name == 'nt':  # Windows
            subprocess.Popen(
                ['node', 'server.js'],
                creationflags=subprocess.CREATE_NO_WINDOW
            )
        else:  # Linux/Mac
            subprocess.Popen(
                ['node', 'server.js'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        
        # 等待服务器启动
        print("   等待服务器启动...", end='')
        for i in range(10):
            time.sleep(1)
            print(".", end='', flush=True)
            if is_port_in_use(3000):
                print()
                print_step(3, 5, "服务器已启动：http://localhost:3000", "成功")
                return True
        
        print()
        print_step(3, 5, "服务器启动超时", "警告")
        return False
    except Exception as e:
        print_step(3, 5, f"启动服务器失败：{e}", "失败")
        return False

def start_ngrok():
    """启动 ngrok 隧道"""
    if is_port_in_use(4040):
        print_step(4, 5, "ngrok 已在运行（端口 4040 被占用）", "提示")
        return True
    
    print_step(4, 5, "正在启动 ngrok 隧道...", "提示")
    
    try:
        # 启动 ngrok（不显示窗口）
        if os.name == 'nt':  # Windows
            subprocess.Popen(
                ['ngrok', 'http', '3000', '--log=stdout'],
                creationflags=subprocess.CREATE_NO_WINDOW
            )
        else:  # Linux/Mac
            subprocess.Popen(
                ['ngrok', 'http', '3000', '--log=stdout'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        
        # 等待 ngrok 启动
        print("   等待 ngrok 启动...", end='')
        for i in range(10):
            time.sleep(1)
            print(".", end='', flush=True)
            if is_port_in_use(4040):
                print()
                print_step(4, 5, "ngrok 已启动", "成功")
                return True
        
        print()
        print_step(4, 5, "ngrok 启动超时", "警告")
        return False
    except Exception as e:
        print_step(4, 5, f"启动 ngrok 失败：{e}", "失败")
        return False

def get_ngrok_url():
    """获取 ngrok 公网地址"""
    print_step(5, 5, "正在获取公网访问地址...", "提示")
    
    try:
        # 等待 ngrok API 就绪
        time.sleep(2)
        
        # 从 ngrok API 获取隧道信息
        max_retries = 5
        for attempt in range(max_retries):
            try:
                resp = urllib.request.urlopen('http://localhost:4040/api/tunnels', timeout=5)
                data = json.loads(resp.read().decode('utf-8'))
                
                if data['tunnels'] and len(data['tunnels']) > 0:
                    public_url = data['tunnels'][0]['public_url']
                    print_step(5, 5, f"ngrok 公网地址：{public_url}", "成功")
                    return public_url
            except Exception as e:
                if attempt < max_retries - 1:
                    time.sleep(1)
                else:
                    raise e
        
        print_step(5, 5, "未找到 ngrok 隧道", "警告")
        return None
    except Exception as e:
        print_step(5, 5, f"获取 ngrok 地址失败：{e}", "警告")
        return None

def test_ngrok_page(ngrok_url):
    """测试 ngrok 公网页面是否能正常打开"""
    if not ngrok_url:
        return False
    
    print_step(5, 5, "正在测试 ngrok 公网页面...", "提示")
    
    try:
        # 测试访问公网地址
        req = urllib.request.Request(ngrok_url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=10)
        
        if resp.status == 200:
            print_step(5, 5, "ngrok 公网页面可以正常访问", "成功")
            return True
        else:
            print_step(5, 5, f"ngrok 公网页面返回状态码：{resp.status}", "警告")
            return False
    except Exception as e:
        print_step(5, 5, f"ngrok 公网页面访问失败：{e}", "警告")
        return False

def main():
    """主函数"""
    print("=" * 60)
    print("   视听语音整合训练系统 v3 - 启动脚本")
    print("=" * 60)
    print()
    
    # 步骤 1：检查 Node.js 和 ngrok
    if not check_node_js():
        input("\n按 Enter 键退出...")
        return
    
    if not check_ngrok():
        print("\n⚠️  无法启动 ngrok，但您可以继续使用本地地址访问")
    
    # 步骤 2：检查依赖
    if not check_dependencies():
        input("\n按 Enter 键退出...")
        return
    
    # 步骤 3：清理端口（新增）
    cleanup_ports()
    
    # 步骤 4：启动服务器
    start_server()
    
    # 步骤 5：启动 ngrok
    ngrok_url = None
    if check_ngrok():
        start_ngrok()
        
        # 获取 ngrok 公网地址
        ngrok_url = get_ngrok_url()
        
        # 测试 ngrok 公网页面（新增）
        if ngrok_url:
            test_ngrok_page(ngrok_url)
    else:
        print("\n⚠️  无法启动 ngrok，但您可以继续使用本地地址访问")
    
    # 显示访问地址
    print()
    print("=" * 60)
    print("           🎉 启动完成！")
    print("=" * 60)
    print()
    
    print("📍 本地访问地址：")
    print(f"   http://localhost:3000/index.html       （患者首页）")
    print(f"   http://localhost:3000/admin.html       （管理员后台）")
    print(f"   http://localhost:3000/history.html     （历史记录）")
    print(f"   http://localhost:3000/soa_test.html    （SOA 同步性独立测试）")
    print()

    if ngrok_url:
        print("🌐 公网访问地址（通过 ngrok）：")
        print(f"   {ngrok_url}/index.html")
        print(f"   {ngrok_url}/admin.html")
        print(f"   {ngrok_url}/soa_test.html")
        print()

    print("=" * 60)
    print()
    print("💡 提示：")
    print("   - 服务器和 ngrok 已在后台运行")
    print("   - 要停止服务器，请关闭对应的进程")
    print()

    # 询问要打开哪个页面
    try:
        print("请选择要在浏览器打开的页面：")
        print("   [1] 管理员后台 (admin.html)  ← 默认")
        print("   [2] 患者首页 (index.html)")
        print("   [3] SOA 同步性测试 (soa_test.html)")
        print("   [N] 不打开")
        choice = input("请输入 [1/2/3/N，默认 1]: ").strip().lower()

        page_map = {
            '':  'admin.html',
            '1': 'admin.html',
            '2': 'index.html',
            '3': 'soa_test.html'
        }
        if choice != 'n' and choice in page_map:
            import webbrowser
            webbrowser.open(f'http://localhost:3000/{page_map[choice]}')
    except:
        pass
    
    print()
    print("按 Ctrl+C 可停止此脚本（服务器仍会运行）...")
    print("=" * 60)
    
    # 保持脚本运行，显示服务器日志
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n脚本已停止。")

if __name__ == '__main__':
    main()
