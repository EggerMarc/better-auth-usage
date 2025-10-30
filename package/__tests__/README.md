# Unit Tests for better-auth-usage

This directory contains comprehensive unit tests for the better-auth-usage plugin.

## Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test package/__tests__/utils.test.ts

# Run with watch mode
bun test --watch
```

## Test Coverage

### Core Utilities (`utils.test.ts`)
- **checkLimit**: Limit validation logic
- **shouldReset**: Reset timing calculations
- **tryCatch**: Promise error handling

### Real-time Features (`realtime/usage-tracker.test.ts`)
- Channel and room naming conventions
- Update structure validation

### Schema Validation (`schema.test.ts`)
- Usage schema validation
- Customer schema validation
- Cached usage structures
- Event validation

## Test Structure

Tests follow Bun's testing conventions using:
- `describe()` for grouping related tests
- `test()` for individual test cases
- `expect()` for assertions