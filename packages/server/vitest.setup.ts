try {
  process.loadEnvFile();
} catch {
  // .env 不存在时静默（如 CI），测试用占位回退值
}
