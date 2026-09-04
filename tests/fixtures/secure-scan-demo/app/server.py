"""Intentionally vulnerable SYNTHETIC fixture for the Stage 5 scanner suite
(see README.md). Never copy these patterns into real code."""

import os
import subprocess


def run_user_command(user_input):
    # BUG (synthetic fixture): shell=True with caller-controlled input.
    return subprocess.run(user_input, shell=True, capture_output=True)


def evaluate_expression(expr):
    # BUG (synthetic fixture): eval() of untrusted input allows arbitrary
    # code execution.
    return eval(expr)


def lookup_user(name):
    # BUG (synthetic fixture): string-concatenated os.system() call.
    return os.system("id " + name)
