import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

describe("frozen Stitch continuation baseline dependency", () => {
  it("pins the exact published 0.34.10 tarball and integrity", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as {
      devDependencies?: Record<string, string>;
    };
    const lock = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "package-lock.json"), "utf8"),
    ) as {
      packages?: Record<
        string,
        { version?: string; resolved?: string; integrity?: string }
      >;
    };

    expect(
      packageJson.devDependencies?.["@synergenius/flow-weaver-baseline"],
    ).toBe("npm:@synergenius/flow-weaver@0.34.10");
    expect(
      lock.packages?.["node_modules/@synergenius/flow-weaver-baseline"],
    ).toMatchObject({
      version: "0.34.10",
      resolved:
        "https://npm.example.com/@synergenius/flow-weaver/-/flow-weaver-0.34.10.tgz",
      integrity:
        "sha512-pmFC5hyAh9ENjTvqEyKCfJY1rpUoqN5QfMGcCwZhUyMncFXyprfoyN05DpqEm033TnBTA4gHxktWI9M/og6NyA==",
    });
  });

  it("pins the exact A3 candidate engine source tree", () => {
    expect(() =>
      execFileSync("git", ["diff", "--quiet", "--", "src"], {
        cwd: repositoryRoot,
        stdio: "pipe",
      }),
    ).not.toThrow();
    const candidateTree = execFileSync("git", ["write-tree"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim();
    const sourceTree = execFileSync(
      "git",
      ["rev-parse", `${candidateTree}:src`],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    ).trim();

    expect(sourceTree).toBe("656ad1578ebdf8e29f9ad30b573c17957bd13760");
  });
});
