import chalk from "chalk";
import type { AgentEvent } from "@supercode/core";

export class TerminalRenderer {
  private spinnerChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private spinnerIndex = 0;
  private spinnerInterval?: ReturnType<typeof setInterval>;
  private currentLine = "";

  startSpinner(label: string): void {
    this.spinnerInterval = setInterval(() => {
      const char = this.spinnerChars[this.spinnerIndex++ % this.spinnerChars.length];
      process.stdout.write(`\r${chalk.cyan(char)} ${label}`);
    }, 80);
  }

  stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = undefined;
      process.stdout.write("\r\x1b[K"); // Clear line
    }
  }

  renderEvent(event: AgentEvent): void {
    switch (event.type) {
      case "assistant_text":
        if (event.text) process.stdout.write(chalk.white(event.text));
        break;

      case "tool_call":
        this.stopSpinner();
        if (event.toolCall) {
          const inputStr = JSON.stringify(event.toolCall.input, null, 2)
            .split("\n")
            .slice(0, 5)
            .join("\n");
          console.log(
            `\n${chalk.cyan("⚙")} ${chalk.bold(event.toolCall.name)} ${chalk.gray(inputStr)}`
          );
        }
        this.startSpinner("Executing...");
        break;

      case "tool_result":
        this.stopSpinner();
        if (event.toolResult) {
          const { success, output, error } = event.toolResult;
          if (success) {
            const preview = output.split("\n").slice(0, 3).join("\n");
            console.log(chalk.green(`  ✓ ${preview.slice(0, 200)}${preview.length > 200 ? "..." : ""}`));
          } else {
            console.log(chalk.red(`  ✗ ${error ?? "Unknown error"}`));
          }
        }
        break;

      case "cost_update":
        // Shown only in verbose mode — suppressed by default
        break;

      case "error":
        this.stopSpinner();
        console.error(chalk.red(`\n✗ Error: ${event.error}`));
        break;

      case "done":
        this.stopSpinner();
        console.log(); // newline after streaming text
        break;
    }
  }

  printWelcome(version: string, model: string): void {
    console.log(chalk.bold.magenta("\n  SuperCode") + chalk.gray(` v${version}`));
    console.log(chalk.gray(`  Model: ${model} · Type /help for commands\n`));
  }

  printCost(summary: string): void {
    console.log(chalk.gray(`  ${summary}`));
  }

  printError(msg: string): void {
    console.error(chalk.red(`\n✗ ${msg}\n`));
  }

  printInfo(msg: string): void {
    console.log(chalk.cyan(`  ${msg}`));
  }

  printSuccess(msg: string): void {
    console.log(chalk.green(`  ✓ ${msg}`));
  }

  prompt(model: string): string {
    return chalk.magenta("›") + chalk.gray(` [${model}] `) + chalk.white("❯ ");
  }
}
