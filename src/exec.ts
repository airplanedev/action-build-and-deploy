import * as aexec from "@actions/exec";

export type ExecOptions = {
  input?: string
}

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
    input: options.input ? Buffer.from(options.input) : undefined,
    listeners: {
      stdout: (data: Buffer) => {
        stdout += data.toString();
      },
      stderr: (data: Buffer) => {
        stderr += data.toString();
      },
    },
  });

  return {
    returnCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
};
