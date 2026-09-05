package com.example;

/**
 * Intentionally vulnerable SYNTHETIC fixture for the Stage 5 scanner suite
 * (see README.md). Never copy these patterns into real code.
 */
public class App {

    public int divide(int a, int b) {
        try {
            return a / b;
        } catch (ArithmeticException e) {
            // BUG (synthetic fixture): empty catch block — PMD EmptyCatchBlock.
        }
        return 0;
    }
}
