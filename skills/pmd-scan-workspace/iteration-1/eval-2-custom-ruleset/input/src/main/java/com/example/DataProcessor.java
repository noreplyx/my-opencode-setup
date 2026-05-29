package com.example;

import java.util.List;
import java.io.File;

/**
 * A data processor with various style and error-prone issues.
 */
public class DataProcessor {

    private String name;
    private int counter = 0;

    public DataProcessor(String name) {
        this.name = name;
    }

    // Method name should start with lowercase - PMD codestyle should flag
    public void ProcessData(List<String> data) {
        // Assigning value to unused local - errorprone
        String temp = null;
        temp = "unused";

        for (int i = 0; i < data.size(); i++) {
            try {
                String item = data.get(i);
                if (item == null) {
                    throw new IllegalArgumentException("Null item at index " + i);
                }
                this.counter++;
            } catch (Exception ex) {
                // Empty catch - errorprone
            }
        }
    }

    // Returning null from a method that returns a collection - error prone
    public List<String> getItems() {
        return null;
    }

    // Method with too many parameters - design
    public void createReport(String title, String author, String date,
                            List<String> sections, String format, boolean includeCharts,
                            boolean includeSummary, int maxPages) {
        // method body
    }

    // Unnecessary conversion - error prone
    public String convertToString(int value) {
        return new Integer(value).toString();
    }

    // Method that calls System.out - codestyle (SystemPrintln)
    public void debugOutput(String msg) {
        System.out.println("DEBUG: " + msg);
    }

    // Method might ignore exceptional return value
    public boolean deleteFile(String path) {
        File f = new File(path);
        f.delete(); // Return value ignored - errorprone
        return true;
    }
}
