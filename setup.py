#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
启动脚本：自动检测依赖（Node.js / npm 包 / ngrok），缺失则提示并尝试自动安装，
然后启动服务器与 ngrok，显示访问地址。

使用方法：双击运行或在命令行运行 `python 启动.py`

主要能力：
1. 启动前先杀掉占用端口（3000、4040）的进程
2. 自动检测 Node.js / npm（缺失则给出官网下载链接 + Windows winget 一键安装）
3. 自动检测 ngrok（缺失则给出官网下载链接 + Windows winget 一键安装）
4. 自动检测项目 node_modules（缺失则 npm install）
5. 启动 server.js 与 ngrok，验证公网页面可访问
"""

import os
import sys
import time
import json
import shutil
import subprocess
import urllib.request
import urllib.error
import socket
import platform

# 项目目录（脚本所在目录）
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(PROJECT_DIR)

IS_WINDOWS = (os.name == 'nt')

# ───────────────────────────── 工具函数 ─────────────────────────────

def print_step(message, status=None):
    """打印步骤信息"""
    prefix_map = {"成功": "✅", "失败": "❌", "警告": "⚠️", "提示": "💡", "执行": "▶️"}
    prefix = prefix_map.get(status, "  ")
    print(f"{prefix} {message}")


def which(cmd):
    """跨平台查找命令绝对路径，找不到返回 None"""
    return shutil.which(cmd)


def is_port_in_use(port):
    """检查端口是否被占用"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result = sock.connect_ex(('localhost', port))
        sock.close()
        return result == 0
    except Exception:
        return False


def kill_port(port):
    """杀掉占用指定端口的进程（Windows）"""
    if not IS_WINDOWS:
        return False
    try:
        result = subprocess.run(
            ['netstat', '-ano'],
            capture_output=True, text=True, encoding='gbk', errors='ignore'
        )
        if result.returncode != 0:
            return False
        for line in result.stdout.split('\n'):
            if f':{port}' in line and 'LISTENING' in line:
                parts = line.split()
                if len(parts) >= 5:
                    pid = parts[-1]
                    print(f"   🔍 端口 {port} 被进程 {pid} 占用，尝试结束...")
                    subprocess.run(
                        ['taskkill', '/F', '/PID', pid],
                        capture_output=True, text=True, encoding='gbk', errors='ignore'
                    )
                    return True
        return False
    except Exception as e:
        print(f"   ⚠️ 清理端口 {port} 失败: {e}")
        return False


def confirm(prompt, default_yes=True):
    """询问用户 y/n"""
    suffix = " [Y/n]: " if default_yes else " [y/N]: "
    try:
        ans = input(prompt + suffix).strip().lower()
    except (EOFError, KeyboardInterrupt):
        return False
    if ans == '':
        return default_yes
    return ans in ('y', 'yes')


# ───────────────────────────── 依赖检测 / 安装 ─────────────────────────────

def has_winget():
    """检测 winget 是否可用（Windows 10/11 自带）"""
    return IS_WINDOWS and which('winget') is not None


def install_via_winget(pkg_id, friendly_name):
    """通过 winget 静默安装"""
    print_step(f"正在通过 winget 安装 {friendly_name}（{pkg_id}）...", "执行")
    try:
        # --accept-source-agreements / --accept-package-agreements 跳过交互
        result = subprocess.run(
            ['winget', 'install', '--id', pkg_id, '-e',
             '--accept-source-agreements', '--accept-package-agreements',
             '--silent'],
            text=True, encoding='utf-8', errors='ignore'
        )
        if result.returncode == 0:
            print_step(f"{friendly_name} 安装完成", "成功")
            return True
        else:
            print_step(f"{friendly_name} 安装失败（exit={result.returncode}）", "失败")
            return False
    except Exception as e:
        print_step(f"调用 winget 安装 {friendly_name} 失败：{e}", "失败")
        return False


def check_node_js():
    """检查 Node.js（与 npm）是否安装。缺失时尝试自动安装。"""
    node_bin = which('node')
    if node_bin:
        try:
            ver = subprocess.run(['node', '--version'],
                                 capture_output=True, text=True,
                                 encoding='utf-8', errors='ignore').stdout.strip()
            print_step(f"Node.js 已安装（{ver}）", "成功")
            return True
        except Exception:
            pass

    print_step("未检测到 Node.js", "失败")
    print("    官网下载（LTS 推荐）：https://nodejs.org/zh-cn/download")

    if has_winget():
        if confirm("是否使用 winget 一键安装 Node.js (LTS)？"):
            if install_via_winget('OpenJS.NodeJS.LTS', 'Node.js LTS'):
                print_step("请重新打开终端或重启电脑使 PATH 生效，然后再次运行本脚本", "提示")
                return False
    else:
        print_step("未检测到 winget；请手动从上面链接下载安装 Node.js（默认勾选添加到 PATH）", "提示")
    return False


def check_npm_packages():
    """检查项目 node_modules，缺失则 npm install"""
    pkg_lock = os.path.join(PROJECT_DIR, 'package.json')
    if not os.path.exists(pkg_lock):
        print_step("找不到 package.json，跳过依赖检查", "警告")
        return True

    if os.path.exists(os.path.join(PROJECT_DIR, 'node_modules')):
        print_step("npm 依赖已就绪", "成功")
        return True

    print_step("npm 依赖未安装，正在执行 npm install...", "执行")
    npm_cmd = 'npm.cmd' if IS_WINDOWS else 'npm'
    try:
        result = subprocess.run(
            [npm_cmd, 'install'],
            text=True, encoding='utf-8', errors='ignore'
        )
        if result.returncode == 0:
            print_step("npm 依赖安装完成", "成功")
            return True
        else:
            print_step(f"npm install 失败（exit={result.returncode}）", "失败")
            return False
    except Exception as e:
        print_step(f"npm install 异常：{e}", "失败")
        return False


def check_ngrok():
    """检查 ngrok 是否安装；缺失时尝试自动安装。返回 bool"""
    if which('ngrok'):
        try:
            ver = subprocess.run(['ngrok', 'version'],
                                 capture_output=True, text=True,
                                 encoding='utf-8', errors='ignore').stdout.strip().split('\n')[0]
            print_step(f"ngrok 已安装（{ver}）", "成功")
            return True
        except Exception:
            pass

    print_step("未检测到 ngrok（仅影响公网访问，不影响本地访问）", "警告")
    print("    官网下载：https://ngrok.com/download")

    if has_winget():
        if confirm("是否使用 winget 一键安装 ngrok？", default_yes=False):
            if install_via_winget('Ngrok.Ngrok', 'ngrok'):
                print_step("请重新打开终端使 PATH 生效，本次运行将跳过公网访问", "提示")
                return False
    return False


# ───────────────────────────── 启动 ─────────────────────────────

def cleanup_ports():
    """清理 3000 / 4040 端口"""
    print_step("正在清理端口 3000 / 4040 ...", "执行")
    for port in (3000, 4040):
        if is_port_in_use(port):
            kill_port(port)
            time.sleep(1)
    print_step("端口清理完成", "成功")


def start_server():
    """启动 Node.js 服务器"""
    if is_port_in_use(3000):
        print_step("服务器已在运行（端口 3000 被占用）", "提示")
        return True

    print_step("正在启动 Node.js 服务器（端口 3000）...", "执行")
    try:
        kwargs = {}
        if IS_WINDOWS:
            kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
        else:
            kwargs['stdout'] = subprocess.DEVNULL
            kwargs['stderr'] = subprocess.DEVNULL
        subprocess.Popen(['node', 'server.js'], **kwargs)

        print("   等待服务器启动", end='')
        for _ in range(10):
            time.sleep(1)
            print(".", end='', flush=True)
            if is_port_in_use(3000):
                print()
                print_step("服务器已启动：http://localhost:3000", "成功")
                return True
        print()
        print_step("服务器启动超时", "警告")
        return False
    except Exception as e:
        print_step(f"启动服务器失败：{e}", "失败")
        return False


def start_ngrok():
    """启动 ngrok 隧道"""
    if is_port_in_use(4040):
        print_step("ngrok 已在运行（端口 4040 被占用）", "提示")
        return True
    print_step("正在启动 ngrok 隧道...", "执行")
    try:
        kwargs = {}
        if IS_WINDOWS:
            kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
        else:
            kwargs['stdout'] = subprocess.DEVNULL
            kwargs['stderr'] = subprocess.DEVNULL
        subprocess.Popen(['ngrok', 'http', '3000', '--log=stdout'], **kwargs)

        print("   等待 ngrok 启动", end='')
        for _ in range(10):
            time.sleep(1)
            print(".", end='', flush=True)
            if is_port_in_use(4040):
                print()
                print_step("ngrok 已启动", "成功")
                return True
        print()
        print_step("ngrok 启动超时", "警告")
        return False
    except Exception as e:
        print_step(f"启动 ngrok 失败：{e}", "失败")
        return False


def get_ngrok_url():
    """从 ngrok API 获取公网地址"""
    print_step("正在获取 ngrok 公网地址...", "执行")
    time.sleep(2)
    try:
        for attempt in range(5):
            try:
                resp = urllib.request.urlopen('http://localhost:4040/api/tunnels', timeout=5)
                data = json.loads(resp.read().decode('utf-8'))
                if data.get('tunnels'):
                    url = data['tunnels'][0]['public_url']
                    print_step(f"公网地址：{url}", "成功")
                    return url
            except Exception:
                if attempt < 4:
                    time.sleep(1)
                else:
                    raise
        return None
    except Exception as e:
        print_step(f"获取公网地址失败：{e}", "警告")
        return None


def test_page(url):
    """简单测试公网页面"""
    if not url:
        return False
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=10)
        if resp.status == 200:
            print_step("公网页面可访问", "成功")
            return True
        print_step(f"公网页面返回 {resp.status}", "警告")
        return False
    except Exception as e:
        print_step(f"公网页面访问失败：{e}", "警告")
        return False


# ───────────────────────────── 主流程 ─────────────────────────────

def main():
    print("=" * 60)
    print("   视听语音整合训练系统 v3 · 一键启动")
    print(f"   OS: {platform.system()} {platform.release()}")
    print("=" * 60)
    print()

    # 1) Node.js（必需）
    if not check_node_js():
        print()
        print_step("缺少 Node.js 时无法启动服务器。请安装后重试。", "失败")
        input("按 Enter 键退出...")
        sys.exit(1)

    # 2) npm 包（必需）
    if not check_npm_packages():
        print()
        print_step("npm 依赖安装失败，无法启动。请手动 cd 到项目目录运行 `npm install`", "失败")
        input("按 Enter 键退出...")
        sys.exit(1)

    # 3) ngrok（可选，仅公网访问需要）
    has_ngrok = check_ngrok()

    # 4) 清理端口
    cleanup_ports()

    # 5) 启动 Node 服务
    if not start_server():
        input("\n按 Enter 键退出...")
        sys.exit(1)

    # 6) 启动 ngrok（如果可用）
    ngrok_url = None
    if has_ngrok:
        if start_ngrok():
            ngrok_url = get_ngrok_url()
            if ngrok_url:
                test_page(ngrok_url)

    # 7) 输出访问信息
    print()
    print("=" * 60)
    print("           🎉 启动完成！")
    print("=" * 60)
    print()
    print("📍 本地访问地址：")
    print(f"   http://localhost:3000/index.html      （患者首页）")
    print(f"   http://localhost:3000/admin.html      （管理员后台）")
    print(f"   http://localhost:3000/history.html    （历史记录与折线图）")
    print(f"   http://localhost:3000/soa_test.html   （SOA 同步性独立测试）")
    print()
    if ngrok_url:
        print("🌐 公网访问地址（ngrok 转发）：")
        print(f"   {ngrok_url}/index.html")
        print(f"   {ngrok_url}/admin.html")
        print()
    print("=" * 60)
    print("💡 提示：服务器与 ngrok 已在后台运行；关闭对应进程可停止。")
    print()

    # 8) 选择默认打开页面
    try:
        print("请选择要在浏览器打开的页面：")
        print("   [1] 管理员后台 (admin.html)  ← 默认")
        print("   [2] 患者首页 (index.html)")
        print("   [3] SOA 同步性测试 (soa_test.html)")
        print("   [N] 不打开")
        choice = input("请输入 [1/2/3/N，默认 1]: ").strip().lower()
        page_map = {'': 'admin.html', '1': 'admin.html',
                    '2': 'index.html', '3': 'soa_test.html'}
        if choice != 'n' and choice in page_map:
            import webbrowser
            webbrowser.open(f'http://localhost:3000/{page_map[choice]}')
    except Exception:
        pass

    print()
    print("按 Ctrl+C 可停止此脚本（服务器仍会运行）...")
    print("=" * 60)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n脚本已停止。")


if __name__ == '__main__':
    main()
