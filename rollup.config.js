import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import esbuild from "rollup-plugin-esbuild";
import { dependencies } from "./package.json";
import { builtinModules } from "module";

export default {
    input: "src/index.js",
    output: [
        { file: "dist/index.mjs", format: "esm" },
        { file: "dist/index.js", format: "cjs", exports: "default" },
    ],
    plugins: [
        resolve(),
        commonjs(),
        json(),
        esbuild({ target: "es2015", minify: true })
    ],
    external: builtinModules.concat(Object.keys(dependencies))
};