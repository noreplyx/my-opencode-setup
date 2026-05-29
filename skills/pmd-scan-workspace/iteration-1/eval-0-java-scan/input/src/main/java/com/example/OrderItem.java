package com.example;

public class OrderItem {
    private String sku;
    private double price;
    private int quantity;
    
    public OrderItem(String sku, double price, int quantity) {
        this.sku = sku;
        this.price = price;
        this.quantity = quantity;
    }
    
    public double getPrice() {
        return price;
    }
    
    public int getQuantity() {
        return quantity;
    }
    
    public String getSku() {
        return sku;
    }
}
