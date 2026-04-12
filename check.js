const fs = require('fs');
const parser = require('@babel/parser');

const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);

if (match) {
  const code = match[1];
  try {
    parser.parse(code, {
      sourceType: "module",
      plugins: ["jsx"]
    });
    console.log("NO SYNTAX ERRORS FOUND!");
  } catch (err) {
    console.error("Syntax Error found:");
    console.error(err.message);
    const line = err.loc.line;
    const lines = code.split('\n');
    console.log("Around line " + line + ":");
    console.log(lines[line - 2]);
    console.log(lines[line - 1]);
    console.log(lines[line]);
  }
} else {
  console.log("No babel script found");
}