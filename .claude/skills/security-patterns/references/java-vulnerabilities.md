# Java/Kotlin Vulnerabilities

## SQL Injection
```java
// VULNERABLE
String query = "SELECT * FROM users WHERE id = " + userId;
Statement stmt = conn.createStatement();
stmt.execute(query);

// SAFE - PreparedStatement
PreparedStatement pstmt = conn.prepareStatement(
    "SELECT * FROM users WHERE id = ?"
);
pstmt.setInt(1, userId);
pstmt.executeQuery();

// JPA/Hibernate safe
entityManager.find(User.class, userId);

// JPA VULNERABLE
@Query("SELECT u FROM User u WHERE u.name = '" + name + "'")
```

## Unsafe Deserialization
```java
// VULNERABLE - ObjectInputStream on untrusted data
ObjectInputStream ois = new ObjectInputStream(untrustedStream);
Object obj = ois.readObject();  // Can execute arbitrary code

// SAFE alternatives
// 1. Use JSON/XML with explicit type binding
ObjectMapper mapper = new ObjectMapper();
mapper.readValue(json, User.class);

// 2. Use serialization filters (Java 9+)
ObjectInputFilter filter = ObjectInputFilter.Config.createFilter(
    "com.myapp.*;!*"
);
```

## XXE (XML External Entity)
```java
// VULNERABLE
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
DocumentBuilder db = dbf.newDocumentBuilder();
db.parse(untrustedXml);

// SAFE - disable external entities
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
```

## Path Traversal
```java
// VULNERABLE
String path = basePath + "/" + userFilename;
new File(path).read();

// SAFE
Path basePath = Paths.get(BASE_DIR).normalize().toAbsolutePath();
Path targetPath = basePath.resolve(userFilename).normalize().toAbsolutePath();
if (!targetPath.startsWith(basePath)) {
    throw new SecurityException("Path traversal detected");
}
```

## Spring Security Misconfiguration
```java
// VULNERABLE - overly permissive
http.authorizeRequests()
    .antMatchers("/admin/**").permitAll();  // Should be authenticated

// SAFE
http.authorizeRequests()
    .antMatchers("/admin/**").hasRole("ADMIN")
    .antMatchers("/api/**").authenticated()
    .anyRequest().authenticated();

// Missing CSRF protection
http.csrf().disable();  // Only for stateless APIs
```

## LDAP Injection
```java
// VULNERABLE
String filter = "(uid=" + username + ")";
ctx.search("ou=users", filter, controls);

// SAFE - escape special characters
String safeUsername = LdapEncoder.filterEncode(username);
String filter = "(uid=" + safeUsername + ")";
```

## Insecure Randomness
```java
// VULNERABLE - predictable
Random random = new Random();
String token = String.valueOf(random.nextLong());

// SAFE - cryptographic
SecureRandom secureRandom = new SecureRandom();
byte[] tokenBytes = new byte[32];
secureRandom.nextBytes(tokenBytes);
```
