#!/bin/bash
# PythonAnywhere 一键部署脚本（在 PA 的 Bash 控制台 /home/<user>/token_rank 目录下运行）
# 用法: bash deploy_pa.sh <用户名>
# 例如: bash deploy_pa.sh zhangsan

set -e
USER="$1"
if [ -z "$USER" ]; then
  echo "请传入 Web 用户名: bash deploy_pa.sh <用户名>"
  exit 1
fi

echo "==> 创建虚拟环境 (python3.12)"
virtualenv --python=python3.12 venv

echo "==> 安装依赖"
venv/bin/pip install --quiet flask requests beautifulsoup4

echo "==> 生成 WSGI 配置"
cat > /home/$USER/token_rank/wsgi.py <<EOF
import sys
project_home = u'/home/$USER/token_rank'
if project_home not in sys.path:
    sys.path = [project_home] + sys.path
from app import app as application
EOF

echo "==> 完成！接下来在网页上操作："
echo "  1. Web 标签页 -> New Web App -> Manual configuration -> Python 3.10/3.12"
echo "  2. Code 部分: Source directory 填  /home/$USER/token_rank"
echo "                WSGI Configuration file 填  /home/$USER/token_rank/wsgi.py"
echo "  3. Virtualenv 填 /home/$USER/token_rank/venv"
echo "  4. 点 Reload，然后访问 https://$USER.pythonanywhere.com"