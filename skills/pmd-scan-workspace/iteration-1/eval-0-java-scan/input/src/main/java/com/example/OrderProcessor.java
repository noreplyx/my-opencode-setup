package com.example;

import java.util.List;
import java.util.ArrayList;

/**
 * A sample order processing class with various PMD-detectable issues.
 */
public class OrderProcessor {

    private String status;
    private List<String> items;
    
    // Unused field - PMD should flag this
    private String unusedConfig;
    
    public OrderProcessor() {
        this.status = "NEW";
        this.items = new ArrayList<>();
        this.unusedConfig = "default";
    }
    
    // Long method - PMD should flag this
    public void processOrder(String orderId, List<OrderItem> orderItems, boolean rush) {
        // Empty catch block - PMD should flag
        try {
            validateOrder(orderId);
        } catch (Exception e) {
            // TODO: handle this
        }
        
        double total = 0.0;
        String temp = ""; // Unused local variable
        
        for (OrderItem item : orderItems) {
            if (item != null) {
                total += item.getPrice() * item.getQuantity();
                if (rush && total > 1000) {
                    total += 25.0; // rush fee
                }
                if (total > 500 && item.getQuantity() > 10) {
                    // Apply bulk discount
                    total = total * 0.9;
                }
            }
        }
        
        // Duplicate string literal "PENDING" used twice here
        if (total > 5000) {
            this.status = "PENDING_REVIEW";
        } else if (total > 1000) {
            this.setStatus("PENDING_APPROVAL");
        }
        
        try {
            persistOrder(orderId, total);
        } catch (Exception ex) {
            // Empty catch - PMD should flag
        }
        
        double tax = total * 0.08;
        double finalTotal = total + tax;
        
        // Method is too long - PMD should flag this
        String summary = "";
        summary += "Order: " + orderId;
        summary += " Total: " + finalTotal;
        summary += " Items: " + orderItems.size();
        summary += " Rush: " + rush;
    }
    
    private void validateOrder(String orderId) {
        if (orderId == null) {
            return; // Returning null for void method - PMD might flag
        }
        if (orderId.length() == 0) {
            // Another empty block
        }
    }
    
    private void persistOrder(String orderId, double total) {
        // stub
    }
    
    public String getStatus() {
        return status;
    }
    
    public void setStatus(String status) {
        this.status = status;
    }
    
    // Unused private method - PMD should flag
    private void calculateDiscount() {
        double discount = 0.0;
    }
}
