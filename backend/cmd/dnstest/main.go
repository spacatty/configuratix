package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const service = "dnspod"

// Endpoints to try - China and International
var endpoints = []struct {
	name    string
	host    string
	version string
}{
	{"China", "dnspod.tencentcloudapi.com", "2021-03-23"},
	{"International", "dnspod.intl.tencentcloudapi.com", "2021-03-23"},
}

func main() {
	if len(os.Args) < 3 {
		fmt.Println("Usage: go run main.go <SecretId> <SecretKey>")
		fmt.Println("")
		fmt.Println("Get credentials from: https://console.cloud.tencent.com/cam/capi")
		os.Exit(1)
	}

	secretID := os.Args[1]
	secretKey := os.Args[2]

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	fmt.Printf("SecretId: %s...%s\n\n", secretID[:8], secretID[len(secretID)-4:])

	for _, ep := range endpoints {
		fmt.Println("========================================")
		fmt.Printf("Testing %s endpoint: %s\n", ep.name, ep.host)
		fmt.Println("========================================")

		// Test: List domains
		fmt.Println("Action: DescribeDomainList")
		resp, err := makeRequest(ctx, secretID, secretKey, ep.host, ep.version, "DescribeDomainList", `{"Type":"ALL"}`)
		if err != nil {
			fmt.Printf("Error: %v\n", err)
		} else {
			printResponse(resp)
		}
		fmt.Println("")
	}
}

func makeRequest(ctx context.Context, secretID, secretKey, host, version, action, payload string) (map[string]interface{}, error) {
	timestamp := time.Now().Unix()
	date := time.Unix(timestamp, 0).UTC().Format("2006-01-02")
	endpoint := "https://" + host

	// Step 1: Build canonical request
	httpRequestMethod := "POST"
	canonicalURI := "/"
	canonicalQueryString := ""
	contentType := "application/json; charset=utf-8"
	canonicalHeaders := fmt.Sprintf("content-type:%s\nhost:%s\nx-tc-action:%s\n",
		contentType, host, strings.ToLower(action))
	signedHeaders := "content-type;host;x-tc-action"
	hashedPayload := sha256hex(payload)

	canonicalRequest := fmt.Sprintf("%s\n%s\n%s\n%s\n%s\n%s",
		httpRequestMethod,
		canonicalURI,
		canonicalQueryString,
		canonicalHeaders,
		signedHeaders,
		hashedPayload)

	// Step 2: Build string to sign
	algorithm := "TC3-HMAC-SHA256"
	credentialScope := fmt.Sprintf("%s/%s/tc3_request", date, service)
	hashedCanonicalRequest := sha256hex(canonicalRequest)
	stringToSign := fmt.Sprintf("%s\n%d\n%s\n%s",
		algorithm,
		timestamp,
		credentialScope,
		hashedCanonicalRequest)

	// Step 3: Calculate signature
	secretDate := hmacSHA256([]byte("TC3"+secretKey), date)
	secretService := hmacSHA256(secretDate, service)
	secretSigning := hmacSHA256(secretService, "tc3_request")
	signature := hex.EncodeToString(hmacSHA256(secretSigning, stringToSign))

	// Step 4: Build authorization header
	authorization := fmt.Sprintf("%s Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		algorithm,
		secretID,
		credentialScope,
		signedHeaders,
		signature)

	// Make the request
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, strings.NewReader(payload))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Host", host)
	req.Header.Set("X-TC-Action", action)
	req.Header.Set("X-TC-Version", version)
	req.Header.Set("X-TC-Timestamp", fmt.Sprintf("%d", timestamp))
	req.Header.Set("Authorization", authorization)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %v\nRaw: %s", err, string(body))
	}

	return result, nil
}

func printResponse(resp map[string]interface{}) {
	prettyJSON, _ := json.MarshalIndent(resp, "", "  ")
	fmt.Println(string(prettyJSON))

	// Check for errors
	if response, ok := resp["Response"].(map[string]interface{}); ok {
		if errInfo, ok := response["Error"].(map[string]interface{}); ok {
			fmt.Printf("\n✗ Error: %s - %s\n", errInfo["Code"], errInfo["Message"])
		} else {
			fmt.Println("\n✓ SUCCESS!")
		}
	}
}

func sha256hex(s string) string {
	hash := sha256.Sum256([]byte(s))
	return hex.EncodeToString(hash[:])
}

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}
