export function shouldLoadWorkingDirectoryEnv(input: {
  cwdEnvExists: boolean;
  isOutpostEnvFile: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = input.env ?? process.env;
  return env.OUTPOST_DISABLE_CWD_ENV_FILE !== "true"
    && input.cwdEnvExists
    && !input.isOutpostEnvFile;
}
