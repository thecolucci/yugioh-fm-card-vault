@echo off
setlocal
title Yu-Gi-Oh! FM - Card Vault

cd /d "%~dp0"

where node.exe >nul 2>&1
if errorlevel 1 goto node_missing

for /f %%V in ('node.exe -p "Number(process.versions.node.split('.')[0])"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 22 goto node_version

where pnpm.cmd >nul 2>&1
if not errorlevel 1 goto pnpm_ready

where corepack.cmd >nul 2>&1
if not errorlevel 1 goto corepack_ready

goto pnpm_missing

:pnpm_ready
if not exist "node_modules" call pnpm.cmd install --frozen-lockfile
if errorlevel 1 goto install_error
call :intro
call pnpm.cmd dev
goto server_done

:corepack_ready
if not exist "node_modules" call corepack.cmd pnpm install --frozen-lockfile
if errorlevel 1 goto install_error
call :intro
call corepack.cmd pnpm dev
goto server_done

:intro
echo.
echo  Yu-Gi-Oh! FM - Card Vault
echo  --------------------------
echo  O servidor local sera iniciado em instantes.
echo  Acesse: http://localhost:3000/
echo.
echo  Mantenha esta janela aberta durante o uso.
echo  Pressione Ctrl+C para encerrar.
echo.
exit /b 0

:node_missing
echo.
echo [ERRO] Node.js nao foi encontrado.
echo Instale o Node.js 22 ou superior e execute este arquivo novamente.
goto finish_error

:node_version
echo.
echo [ERRO] Este projeto requer Node.js 22 ou superior.
echo Versao encontrada:
node.exe --version
goto finish_error

:pnpm_missing
echo.
echo [ERRO] pnpm ou Corepack nao foram encontrados.
echo Instale o pnpm e execute este arquivo novamente.
goto finish_error

:install_error
echo.
echo [ERRO] Nao foi possivel instalar as dependencias do projeto.
goto finish_error

:server_done
if errorlevel 1 goto start_error
exit /b 0

:start_error
echo.
echo [ERRO] Nao foi possivel iniciar o Card Vault.

:finish_error
echo Consulte a mensagem exibida acima.
echo.
pause
exit /b 1
