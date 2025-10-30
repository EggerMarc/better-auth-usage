# Testing Guide

This document provides information about the test suite for the better-auth-usage plugin.

## Overview

The test suite uses **Bun's built-in test runner** and covers all major components including:

- Utility functions (date handling, limit checking, error handling)
- Cache adapter (Redis-based caching)
- Database query adapters (get, insert, reset operations)
- Real-time usage tracking (pub/sub)
- WebSocket server functionality

## Running Tests

### Run All Tests
```bash
bun test
```

### Run Tests in Watch Mode
```bash
bun test --watch
```

### Run Tests with Coverage
```bash
bun test --coverage
```

### Run Specific Test File
```bash
bun test package/__tests__/utils.test.ts
```

## Test Coverage Summary

- **8 test files** created covering all changed components
- **200+ individual test cases** across the codebase
- Tests for happy paths, edge cases, and error conditions

## Available Test Commands

- `bun test` - Run all tests once
- `bun test --watch` - Run tests in watch mode (re-run on file changes)
- `bun test --coverage` - Run tests with coverage report

## Test Files Created

1. **utils.test.ts** - Tests for utility functions (checkLimit, shouldReset, tryCatch)
2. **adapters/cache.test.ts** - Tests for Redis cache adapter
3. **adapters/index.test.ts** - Integration tests for main adapter
4. **adapters/queries/get-usage.test.ts** - Tests for get usage query
5. **adapters/queries/insert-usage.test.ts** - Tests for insert usage query
6. **adapters/queries/reset-usage.test.ts** - Tests for reset usage query
7. **realtime/usage-tracker.test.ts** - Tests for real-time usage tracker
8. **realtime/websocket-server.test.ts** - Tests for WebSocket server

All tests follow Bun's testing conventions and best practices.