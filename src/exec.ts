import * as aexec from "@actions/exec";
import * as core from "@actions/core";
import { NullWritable } from "null-writable"


export type ExecOptions = {
  prefix?: string
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
    
    // We manage stdout/stderr ourselves via listeners:
    outStream: new NullWritable(),
    errStream: new NullWritable(),
    
    listeners: {
      stdout: (data: Buffer) => {
        const s = data.toString();
        stdout += s
        if (options.prefix !== undefined) {
          console.log(`[${options.prefix}] ${s}`)
        } else {
          console.log(s)
        }
      },
      stderr: (data: Buffer) => {
        const s = data.toString();
        stderr += s
        if (options.prefix !== undefined) {
          console.error(`[${options.prefix}] ${s}`)
        } else {
          console.error(s)
        }
      },
    },
  });

  return {
    returnCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
};
