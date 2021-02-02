import * as aexec from "@actions/exec";
import { ExecOptions } from "@actions/exec";
import * as core from "@actions/core";

export const exec = async (
  cmd: string[],
  options: ExecOptions = {}
): Promise<{
  returnCode: number;
  stdout: string;
  stderr: string;
}> => {
  if (cmd.length === 0) {
    throw new Error("A command is required");
  }

  let stdout = "";
  let stderr = "";
  const returnCode = await aexec.exec(cmd[0], cmd.slice(1), {
    listeners: {
      stdout: (data: Buffer) => {
        const s = data.toString();
        stdout += s;
        core.debug(s);
      },
      stderr: (data: Buffer) => {
        const s = data.toString();
        stderr += s;
        core.debug(s);
      },
    },
    ...options,
  });

  return {
    returnCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
};
