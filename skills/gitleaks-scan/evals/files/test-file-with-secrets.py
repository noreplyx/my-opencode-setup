#!/usr/bin/env python3
"""Test file with various secret patterns for gitleaks scanning evaluation."""

import os

# NOTE: These are intentionally TEST/FAKE secrets for gitleaks evaluation.
# They use "-TEST-" markers so GitHub push protection doesn't block them,
# while still matching gitleaks detection patterns.

# AWS Secret Key (test pattern - not real)
AWS_SECRET_KEY = "wJalrXUtnFEMI-TEST-/K7MDENG/bPxRfiCYEXAMPLEKEY"

# GitHub Personal Access Token (test pattern - not real)
GITHUB_TOKEN = "ghp_TEST_abc123def456ghi789jkl012mno345pqr678st"

# Generic API Key
API_KEY = "sk_live_TEST_1234abcdef5678ghij9012klmn3456opqr"

# Slack Bot Token
SLACK_TOKEN = "xoxb-TEST-123456789012-1234567890123-abc123def456ghi789jkl012mno3"

# Private Key (test pattern)
PRIVATE_KEY = """-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0gL5xL8m9YxXv3K5pZmqZ6Q7n4R2t8wX9yF1b3HcVnJm
-----END RSA PRIVATE KEY-----
"""

class Config:
    def __init__(self):
        # These should NOT be flagged - env var references
        self.db_password = os.environ.get("DB_PASSWORD", "default_password")
        self.api_key = os.environ.get("API_KEY", "")

    def safe_method(self):
        # This is safe - reading from env
        return os.environ.get("SECRET_TOKEN", "")

def main():
    config = Config()
    print(f"Configured: {config.db_password}")
    # This API key is hardcoded - should be flagged
    stripe_api_key = "sk_test_TEST_4eC39HqLyjWDarjtT1zdp7dc"
    print(f"Using API: {stripe_api_key}")

if __name__ == "__main__":
    main()
