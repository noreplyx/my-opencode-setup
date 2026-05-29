package com.example;

public class ProfileService {
    
    public String formatDisplayName(String first, String last) {
        StringBuilder sb = new StringBuilder();
        if (first != null && !first.isEmpty()) {
            sb.append(first.trim());
        }
        if (last != null && !last.isEmpty()) {
            if (sb.length() > 0) {
                sb.append(" ");
            }
            sb.append(last.trim());
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
    
    public String formatLocation(String city, String state, String country) {
        StringBuilder sb = new StringBuilder();
        if (city != null && !city.isEmpty()) {
            sb.append(city.trim());
        }
        if (state != null && !state.isEmpty()) {
            if (sb.length() > 0) {
                sb.append(", ");
            }
            sb.append(state.trim());
        }
        if (country != null && !country.isEmpty()) {
            if (sb.length() > 0) {
                sb.append(" ");
            }
            sb.append(country.trim());
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
