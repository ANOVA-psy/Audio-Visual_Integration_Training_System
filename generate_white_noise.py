#!/usr/bin/env python3
"""
生成白噪音 WAV 文件用于视听训练系统
"""

import wave
import struct
import random
import os

def generate_white_noise(filename='audio/white_noise.wav', duration=4.0, sample_rate=44100):
    """
    生成白噪音 WAV 文件
    
    参数:
        filename: 输出文件名
        duration: 时长（秒）
        sample_rate: 采样率（Hz）
    """
    # 确保 audio 目录存在
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    
    # WAV 文件参数
    num_channels = 1  # 单声道
    sample_width = 2   # 16-bit = 2 bytes
    num_frames = int(duration * sample_rate)
    
    # 生成白噪音数据
    # 16-bit 范围: -32768 到 32767
    samples = []
    for i in range(num_frames):
        # 生成 -0.5 到 0.5 范围的白噪音
        value = int(16384 * (random.random() * 2 - 1))  # 峰值约 50%
        samples.append(value)
    
    # 写入 WAV 文件
    with wave.open(filename, 'w') as wav_file:
        wav_file.setnchannels(num_channels)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(sample_rate)
        
        # 将样本转换为二进制数据
        binary_data = struct.pack('<' + 'h' * len(samples), *samples)
        wav_file.writeframes(binary_data)
    
    print(f"✓ 白噪音文件已生成: {filename}")
    print(f"  - 时长: {duration} 秒")
    print(f"  - 采样率: {sample_rate} Hz")
    print(f"  - 声道: {num_channels} (单声道)")
    print(f"  - 位深度: {sample_width * 8} bit")
    
    # 获取文件大小
    file_size = os.path.getsize(filename)
    print(f"  - 文件大小: {file_size / 1024:.1f} KB")

if __name__ == '__main__':
    # 生成 4 秒白噪音
    generate_white_noise('audio/white_noise.wav', duration=4.0)
    
    # 同时生成一个更长的版本（10秒）用于需要更长噪音的场景
    generate_white_noise('audio/white_noise_long.wav', duration=10.0)
