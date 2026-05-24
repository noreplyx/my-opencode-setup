# Sample Python file for semgrep scanning

def login():
    password = "supersecret123"  # no-hardcoded-passwords violation
    return password

def debug_log():
    print("Debug info")  # no-print-statements violation
    print("More debug")  # no-print-statements violation

def process_data(data):
    result = eval(data)  # no-eval-usage violation
    return result
