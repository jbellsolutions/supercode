#!/bin/bash
set -e

INSTALL_DIR="$HOME/.supercode"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "  ⚡ SuperCode Installer"
echo "  ─────────────────────"
echo ""

# ── Check Node.js ─────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js not found. Install it from https://nodejs.org (v18+)${NC}"
  exit 1
fi
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo -e "${RED}✗ Node.js v18+ required (you have $(node -v))${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Node.js $(node -v)"

# ── Install pnpm if needed ────────────────────────────────────────────────────
if ! command -v pnpm &>/dev/null; then
  echo "  Installing pnpm..."
  npm install -g pnpm --silent
fi
echo -e "  ${GREEN}✓${NC} pnpm $(pnpm -v)"

# ── Clone or update repo ──────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "  Updating existing install..."
  cd "$INSTALL_DIR" && git pull --quiet
else
  # Directory exists but isn't a git repo — wipe and re-clone
  if [ -d "$INSTALL_DIR" ]; then
    echo "  Removing old folder and re-cloning..."
    rm -rf "$INSTALL_DIR"
  fi
  echo "  Cloning SuperCode..."
  git clone --quiet https://github.com/jbellsolutions/supercode "$INSTALL_DIR"
fi
echo -e "  ${GREEN}✓${NC} Source ready at $INSTALL_DIR"

# ── Build ─────────────────────────────────────────────────────────────────────
cd "$INSTALL_DIR"
echo "  Installing dependencies..."
pnpm install --frozen-lockfile --silent
echo "  Building..."
pnpm build
echo -e "  ${GREEN}✓${NC} Built successfully"

# ── Write launcher script ─────────────────────────────────────────────────────
LAUNCHER="$INSTALL_DIR/bin/supercode"
mkdir -p "$INSTALL_DIR/bin"

cat > "$LAUNCHER" << 'SCRIPT'
#!/bin/bash
# Load API keys from ~/.supercode/keys if present
if [ -f "$HOME/.supercode/keys" ]; then
  source "$HOME/.supercode/keys"
fi
exec node "$HOME/.supercode/packages/cli/dist/index.js" "$@"
SCRIPT
chmod +x "$LAUNCHER"

# ── Install launcher to PATH ──────────────────────────────────────────────────
INSTALL_TARGET=""
for dir in "/usr/local/bin" "$HOME/.local/bin" "$HOME/bin"; do
  if echo "$PATH" | grep -q "$dir"; then
    INSTALL_TARGET="$dir"
    break
  fi
done

if [ -z "$INSTALL_TARGET" ]; then
  INSTALL_TARGET="$HOME/.local/bin"
  mkdir -p "$INSTALL_TARGET"
fi

if [ -w "$INSTALL_TARGET" ]; then
  cp "$LAUNCHER" "$INSTALL_TARGET/supercode"
else
  sudo cp "$LAUNCHER" "$INSTALL_TARGET/supercode"
fi
echo -e "  ${GREEN}✓${NC} Installed to $INSTALL_TARGET/supercode"

# ── API Key setup ─────────────────────────────────────────────────────────────
KEYS_FILE="$HOME/.supercode/keys"
echo ""
echo "  ─────────────────────"
echo "  API Key Setup"
echo "  ─────────────────────"
echo ""

if [ -n "$OPENROUTER_API_KEY" ]; then
  echo -e "  ${GREEN}✓${NC} OPENROUTER_API_KEY already set in environment"
else
  echo -e "  ${YELLOW}→${NC} Enter your OpenRouter API key (get one free at https://openrouter.ai/keys)"
  echo -n "    Key (sk-or-v1-...): "
  read -r OR_KEY
  if [ -n "$OR_KEY" ]; then
    echo "export OPENROUTER_API_KEY=\"$OR_KEY\"" >> "$KEYS_FILE"
    export OPENROUTER_API_KEY="$OR_KEY"
    echo -e "  ${GREEN}✓${NC} Key saved to ~/.supercode/keys"
  else
    echo -e "  ${YELLOW}⚠${NC}  Skipped. Set it later: echo 'export OPENROUTER_API_KEY=your-key' >> ~/.supercode/keys"
  fi
fi

echo ""
echo -e "  ${YELLOW}→${NC} Optional: Gemini API key (free tier, https://aistudio.google.com)"
echo -n "    Key (AIza... or skip): "
read -r GM_KEY
if [ -n "$GM_KEY" ]; then
  echo "export GEMINI_API_KEY=\"$GM_KEY\"" >> "$KEYS_FILE"
  echo -e "  ${GREEN}✓${NC} Gemini key saved"
fi

# ── Shell profile update ──────────────────────────────────────────────────────
if [ -f "$HOME/.zshrc" ]; then PROFILE="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then PROFILE="$HOME/.bashrc"
elif [ -f "$HOME/.bash_profile" ]; then PROFILE="$HOME/.bash_profile"
else PROFILE="$HOME/.profile"
fi

# Add keys file sourcing to shell profile if not already there
if ! grep -q ".supercode/keys" "$PROFILE" 2>/dev/null; then
  echo "" >> "$PROFILE"
  echo "# SuperCode API keys" >> "$PROFILE"
  echo '[ -f "$HOME/.supercode/keys" ] && source "$HOME/.supercode/keys"' >> "$PROFILE"
fi

# Add .local/bin to PATH if needed
if [[ "$INSTALL_TARGET" == *".local/bin"* ]]; then
  if ! grep -q ".local/bin" "$PROFILE" 2>/dev/null; then
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$PROFILE"
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "  ─────────────────────────────────────────"
echo -e "  ${GREEN}✓ SuperCode installed!${NC}"
echo "  ─────────────────────────────────────────"
echo ""
echo "  Usage (from any directory):"
echo ""
echo -e "    ${YELLOW}supercode${NC}                     # interactive REPL"
echo -e "    ${YELLOW}supercode \"fix this bug\"${NC}       # one-shot"
echo -e "    ${YELLOW}supercode --mode dontAsk${NC}       # no approval prompts"
echo ""
echo "  To start now (without opening a new terminal):"
echo ""
echo -e "    ${YELLOW}source $PROFILE && supercode${NC}"
echo ""
