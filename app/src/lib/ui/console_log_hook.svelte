<script lang="ts">
  import { writable } from "svelte/store";

  function my_stringify(x: object) {
    return JSON.stringify(x, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
  }
  eval("globalThis.my_stringify = my_stringify");

  function timestamp(): string {
    return new Date().toISOString().slice(11, -2);
  }

  export function patch_console_log() {
    let buf = writable("");

    eval("console.clog = console.log");

    let clog = console.log;
    window.console.log = (...args) => {
      clog(...args);
      const time = timestamp();
      const data = args
        .map((arg) => {
          if (!arg) {
            return "null";
          }

          if (typeof arg === "string") {
            return arg;
          }

          return my_stringify(arg);
        })
        .join(" ");

      buf.update((x) => `${x}\n${time} ${data}`);
    };

    return buf;
  }

  let buf = writable("");

  eval("console.clog = console.log");

  let clog = console.log;
  let f = (...args: any[]) => {
    clog(...args);
    const time = timestamp();
    const _data = args[0].toString().includes("%c")
      ? [...args.shift().match(/(%C)?[^%]*/gi)]
          .map((x) =>
            x.match(/^%C/i)
              ? `<span style="${args.shift()}">${x.slice(2)}</span>`
              : x,
          )
          .join(" ")
      : args
          .map((arg) => {
            if (!arg) {
              return "null";
            }

            if (typeof arg === "string") {
              return arg;
            }

            return my_stringify(arg);
          })
          .join(" ");
    const data = _data;
    buf.update((x) => `${x}\n${time} ${data}`);
  };
  globalThis.console.log = (...args) => f(...args);
  globalThis.console.info = (...args) => f(...args);
  globalThis.console.warn = (...args) => f(...args);
  globalThis.console.error = (...args) => f(...args);
  globalThis.console.debug = (...args) => f(...args);
  globalThis.console.trace = (...args) => f(...args);
</script>

<button
  onclick={() => {
    $buf = "";
  }}>Clear</button
>
{@html $buf.replace(/\n/g, "<br />")}
