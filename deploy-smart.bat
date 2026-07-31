@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo ========================================
echo    OmniBox Spider Worker 智能部署
echo ========================================
echo.

:: 检查管理员权限
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️  建议以管理员身份运行以获得最佳体验
    echo.
)

:: 步骤 1: 检查 Node.js
echo [步骤 1/7] 检查 Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 未安装 Node.js
    echo.
    echo 请访问 https://nodejs.org/ 下载并安装 Node.js LTS 版本
    echo 安装完成后重新运行此脚本
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo ✓ Node.js 已安装: !NODE_VERSION!
echo.

:: 步骤 2: 安装 Wrangler
echo [步骤 2/7] 检查 Wrangler...
where wrangler >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️  未安装 Wrangler，正在安装...
    npm install -g wrangler
    if !errorlevel! neq 0 (
        echo ❌ Wrangler 安装失败
        pause
        exit /b 1
    )
)

for /f "tokens=*" %%i in ('wrangler --version') do set WRANGLER_VERSION=%%i
echo ✓ Wrangler 已安装: !WRANGLER_VERSION!
echo.

:: 步骤 3: 检查项目依赖
echo [步骤 3/7] 检查项目依赖...
if not exist "node_modules" (
    echo ⚠️  未找到依赖，正在安装...
    call npm install
    if !errorlevel! neq 0 (
        echo ❌ 依赖安装失败
        pause
        exit /b 1
    )
)
echo ✓ 项目依赖已就绪
echo.

:: 步骤 4: 构建配置文件
echo [步骤 4/7] 构建配置文件...
if not exist "scripts\build-config.js" (
    echo ❌ 未找到构建脚本
    pause
    exit /b 1
)

call node scripts\build-config.js
if %errorlevel% neq 0 (
    echo ❌ 配置文件构建失败
    pause
    exit /b 1
)
echo ✓ 配置文件构建完成
echo.

:: 步骤 5: 登录 Cloudflare
echo [步骤 5/7] 检查 Cloudflare 登录状态...
wrangler whoami >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ⚠️  未登录 Cloudflare
    echo 正在打开浏览器进行授权...
    echo.
    wrangler login
    if !errorlevel! neq 0 (
        echo ❌ 登录失败
        pause
        exit /b 1
    )
)

for /f "tokens=2 delims=:" %%i in ('wrangler whoami 2^>^&1 ^| findstr "Account Name"') do set CF_ACCOUNT=%%i
echo ✓ 已登录 Cloudflare:!CF_ACCOUNT!
echo.

:: 步骤 6: 部署到 Cloudflare Workers
echo [步骤 6/6] 部署到 Cloudflare Workers...
echo.

wrangler deploy
if %errorlevel% neq 0 (
    echo.
    echo ❌ 部署失败
    echo.
    echo 常见问题:
    echo 1. 检查网络连接
    echo 2. 确认 Cloudflare 账户状态
    echo 3. 查看错误信息并尝试解决
    echo.
    pause
    exit /b 1
)

:: 提取 Worker URL
for /f "tokens=2 delims= " %%i in ('wrangler deployments view 2^>^&1 ^| findstr "https://"') do set WORKER_URL=%%i

echo.
echo ========================================
echo          🎉 部署成功！
echo ========================================
echo.
echo 📝 Worker 信息:
echo    URL: !WORKER_URL!
echo.
echo 📺 TVBox 多仓配置地址:
echo    !WORKER_URL!/dc.json
echo.
echo 📖 API 接口:
echo    爬虫列表: !WORKER_URL!/api/spiders
echo.
echo 💡 提示:
echo    - 在 TVBox 应用中添加配置地址即可使用
echo    - 使用 'wrangler tail' 查看实时日志
echo    - 访问 Cloudflare Dashboard 管理你的 Worker
echo.
echo ========================================
echo.

:: 询问是否打开浏览器
set /p OPEN_BROWSER="是否打开浏览器查看 Worker？(Y/N): "
if /i "%OPEN_BROWSER%"=="Y" (
    start !WORKER_URL!
)

pause
