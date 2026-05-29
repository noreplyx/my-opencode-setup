package com.example;

public class UserService {
    
    public String formatUserName(String firstName, String lastName) {
        StringBuilder sb = new StringBuilder();
        if (firstName != null && !firstName.isEmpty()) {
            sb.append(firstName.trim());
        }
        if (lastName != null && !lastName.isEmpty()) {
            if (sb.length() > 0) {
                sb.append(" ");
            }
            sb.append(lastName.trim());
        }
        String result = sb.toString().toLowerCase();
        String[] parts = result.split(" ");
        StringBuilder output = new StringBuilder();
        for (String part : parts) {
            if (part.length() > 0) {
                output.append(Character.toUpperCase(part.charAt(0)))
                      .append(part.substring(1))
                      .append(" ");
            }
        }
        return output.toString().trim();
    }
    
    public String formatAddress(String street, String city, String zip) {
        StringBuilder sb = new StringBuilder();
        if (street != null && !street.isEmpty()) {
            sb.append(street.trim());
        }
        if (city != null && !city.isEmpty()) {
            if (sb.length() > 0) {
                sb.append(", ");
            }
            sb.append(city.trim());
        }
        if (zip != null && !zip.isEmpty()) {
            if (sb.length() > 0) {
                sb.append(" ");
            }
            sb.append(zip.trim());
        }
        String result = sb.toString().toLowerCase();
        String[] parts = result.split(" ");
        StringBuilder output = new StringBuilder();
        for (String part : parts) {
            if (part.length() > 0) {
                output.append(Character.toUpperCase(part.charAt(0)))
                      .append(part.substring(1))
                      .append(" ");
            }
        }
        return output.toString().trim();
    }
}
