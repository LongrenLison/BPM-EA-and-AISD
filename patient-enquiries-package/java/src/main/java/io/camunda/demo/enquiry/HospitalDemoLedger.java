package io.camunda.demo.enquiry;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import java.util.function.Function;
import java.util.function.Supplier;

/** Local demonstration receipts, not a replacement for a payment provider's idempotency API. */
final class HospitalDemoLedger {
  private final Path directory;

  HospitalDemoLedger(Path directory) {
    this.directory = directory.toAbsolutePath().normalize();
  }

  synchronized Map<String, Object> once(String key, Supplier<Map<String, Object>> action) {
    return transaction(key, existing -> existing.isEmpty() ? action.get() : existing);
  }

  /** Locks across JVMs and atomically stores the complete payment/refund receipt. */
  synchronized Map<String, Object> transaction(
      String key, Function<Map<String, Object>, Map<String, Object>> action) {
    try {
      Files.createDirectories(directory);
      try (FileChannel channel = FileChannel.open(directory.resolve("ledger.lock"),
          StandardOpenOption.CREATE, StandardOpenOption.WRITE);
          FileLock ignored = channel.lock()) {
        Path receipt = directory.resolve(hash(key) + ".properties");
        Map<String, Object> previous = read(receipt);
        Map<String, Object> result = new LinkedHashMap<>(action.apply(previous));
        write(receipt, result);
        return result;
      }
    } catch (IOException e) {
      throw new IllegalStateException("Could not persist hospital demo receipt", e);
    }
  }

  static String hash(String key) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
          .digest(key.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  private Map<String, Object> read(Path file) throws IOException {
    Map<String, Object> result = new LinkedHashMap<>();
    if (!Files.exists(file)) return result;
    Properties properties = new Properties();
    try (InputStream input = Files.newInputStream(file)) {
      properties.load(input);
    }
    for (String name : properties.stringPropertyNames()) {
      String value = properties.getProperty(name);
      result.put(name, switch (value.substring(0, 2)) {
        case "B:" -> Boolean.valueOf(value.substring(2));
        case "N:" -> new BigDecimal(value.substring(2));
        default -> value.substring(2);
      });
    }
    return result;
  }

  private void write(Path file, Map<String, Object> values) throws IOException {
    Properties properties = new Properties();
    values.forEach((key, value) -> {
      if (value == null) throw new IllegalArgumentException("Null receipt value: " + key);
      String prefix = value instanceof Boolean ? "B:" : value instanceof Number ? "N:" : "S:";
      properties.setProperty(key, prefix + value);
    });
    Path temporary = Files.createTempFile(directory, "receipt-", ".tmp");
    try {
      try (OutputStream output = Files.newOutputStream(temporary)) {
        properties.store(output, "Local hospital demonstration receipt");
      }
      try {
        Files.move(temporary, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
      } catch (AtomicMoveNotSupportedException e) {
        Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING);
      }
    } finally {
      Files.deleteIfExists(temporary);
    }
  }
}
