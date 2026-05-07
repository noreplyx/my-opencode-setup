const fs = require('fs');
const path = require('path');

const AGENTS_DIR = path.resolve(__dirname, '..', 'agents');
const SKILLS_DIR = path.resolve(__dirname, '..', 'skills');

let hasError = false;

/**
 * Validates the YAML frontmatter of an agent .md file.
 * Required: description, mode, tools, permission
 * Must have opening and closing ---
 */
function validateAgentYamlFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Check first line is ---
  if (lines[0].trim() !== '---') {
    console.error(`❌ ${filePath}: Missing opening '---' frontmatter delimiter`);
    return false;
  }

  // Find closing ---
  let endLine = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endLine = i;
      break;
    }
  }

  if (endLine === -1) {
    console.error(`❌ ${filePath}: Missing closing '---' frontmatter delimiter`);
    return false;
  }

  // Extract and validate YAML
  const yamlContent = lines.slice(1, endLine).join('\n');

  // Check for required fields
  const hasDescription = /^description:/m.test(yamlContent);
  const hasMode = /^mode:/m.test(yamlContent);
  const hasTools = /^tools:/m.test(yamlContent);
  const hasPermission = /^permission:/m.test(yamlContent);

  if (!hasDescription) {
    console.error(`❌ ${filePath}: Missing 'description' field in frontmatter`);
    return false;
  }
  if (!hasMode) {
    console.error(`❌ ${filePath}: Missing 'mode' field in frontmatter`);
    return false;
  }
  if (!hasTools) {
    console.error(`❌ ${filePath}: Missing 'tools' field in frontmatter`);
    return false;
  }
  if (!hasPermission) {
    console.error(`❌ ${filePath}: Missing 'permission' field in frontmatter`);
    return false;
  }

  const relativePath = path.relative(AGENTS_DIR, filePath);
  console.log(`✅ agents/${relativePath} - valid`);
  return true;
}

/**
 * Validates the YAML frontmatter of a skill SKILL.md file.
 * Required: name
 * Optional (warn if missing): description
 * Must have opening and closing ---
 */
function validateSkillYamlFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Check first line is ---
  if (lines[0].trim() !== '---') {
    console.error(`❌ ${filePath}: Missing opening '---' frontmatter delimiter`);
    return false;
  }

  // Find closing ---
  let endLine = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endLine = i;
      break;
    }
  }

  if (endLine === -1) {
    console.error(`❌ ${filePath}: Missing closing '---' frontmatter delimiter`);
    return false;
  }

  // Extract and validate YAML
  const yamlContent = lines.slice(1, endLine).join('\n');

  // Check for required fields
  const hasName = /^name:/m.test(yamlContent);
  const hasDescription = /^description:/m.test(yamlContent);

  if (!hasName) {
    console.error(`❌ ${filePath}: Missing 'name' field in frontmatter`);
    return false;
  }
  if (!hasDescription) {
    console.warn(`⚠️  ${filePath}: Missing 'description' field in frontmatter`);
  }

  console.log(`✅ skills/${path.basename(path.dirname(filePath))}/SKILL.md - valid`);
  return true;
}

/**
 * Scans the agents directory recursively for all .md files and validates their frontmatter.
 */
function scanAgentsDirectory(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      scanAgentsDirectory(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const valid = validateAgentYamlFrontmatter(fullPath);
      if (!valid) hasError = true;
    }
  }
}

/**
 * Scans the skills directory recursively for SKILL.md files and validates their frontmatter.
 */
function scanSkillsDirectory(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Check if this directory contains a SKILL.md
      const skillPath = path.join(fullPath, 'SKILL.md');
      if (fs.existsSync(skillPath)) {
        const valid = validateSkillYamlFrontmatter(skillPath);
        if (!valid) hasError = true;
      }
      // Recurse into subdirectories
      scanSkillsDirectory(fullPath);
    }
  }
}

// Main
console.log('🔍 Validating YAML frontmatter...');
console.log('📁 Agents:');
scanAgentsDirectory(AGENTS_DIR);
console.log('');
console.log('📁 Skills:');
scanSkillsDirectory(SKILLS_DIR);
console.log('');

if (hasError) {
  console.error('❌ Some files have invalid frontmatter.');
  process.exit(1);
} else {
  console.log('✅ All files have valid frontmatter.');
}
