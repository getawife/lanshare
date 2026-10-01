package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const cert_filename = "cert.pem"
const key_filename = "key.pem"

func cert_fingerprint(der []byte) string {
	sum := sha256.Sum256(der)
	return hex.EncodeToString(sum[:])
}

func generate_cert() (certPEM []byte, keyPEM []byte, err error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 127))
	if err != nil {
		return nil, nil, err
	}
	tmpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "lanshare"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, nil, err
	}
	key_der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, nil, err
	}
	certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM = pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: key_der})
	return certPEM, keyPEM, nil
}

func load_or_create_cert(dir string) (tls.Certificate, string, error) {
	var cert_pem, key_pem []byte
	cert_path := filepath.Join(dir, cert_filename)
	key_path := filepath.Join(dir, key_filename)
	if dir != "" {
		c, cerr := os.ReadFile(cert_path)
		k, kerr := os.ReadFile(key_path)
		if cerr == nil && kerr == nil {
			cert_pem, key_pem = c, k
		} else if (cerr != nil && !errors.Is(cerr, os.ErrNotExist)) || (kerr != nil && !errors.Is(kerr, os.ErrNotExist)) {
			return tls.Certificate{}, "", fmt.Errorf("failed to read device certificate")
		}
	}
	if cert_pem == nil {
		var err error
		cert_pem, key_pem, err = generate_cert()
		if err != nil {
			return tls.Certificate{}, "", fmt.Errorf("failed to generate device certificate: %w", err)
		}
		if dir != "" {
			if err := os.MkdirAll(dir, 0o700); err != nil {
				return tls.Certificate{}, "", err
			}
			if err := os.WriteFile(key_path, key_pem, 0o600); err != nil {
				return tls.Certificate{}, "", err
			}
			if err := os.WriteFile(cert_path, cert_pem, 0o600); err != nil {
				return tls.Certificate{}, "", err
			}
		}
	}
	cert, err := tls.X509KeyPair(cert_pem, key_pem)
	if err != nil {
		return tls.Certificate{}, "", fmt.Errorf("invalid device certificate: %w", err)
	}
	return cert, cert_fingerprint(cert.Certificate[0]), nil
}

func (s *server_state) tls_config() *tls.Config {
	return &tls.Config{
		Certificates: []tls.Certificate{s.cert},
		MinVersion:   tls.VersionTLS13,
		ClientAuth:   tls.RequestClientCert,
	}
}

func (s *server_state) peer_client(fp string, timeout time.Duration) (*http.Client, error) {
	if fp == "" {
		return nil, errors.New("peer did not advertise a certificate fingerprint")
	}
	cfg := &tls.Config{
		Certificates:       []tls.Certificate{s.cert},
		MinVersion:         tls.VersionTLS13,
		InsecureSkipVerify: true,
		VerifyPeerCertificate: func(raw [][]byte, _ [][]*x509.Certificate) error {
			if len(raw) == 0 || cert_fingerprint(raw[0]) != fp {
				return errors.New("peer certificate does not match advertised fingerprint")
			}
			return nil
		},
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: &http.Transport{TLSClientConfig: cfg},
	}, nil
}

func sender_fingerprint(r *http.Request) string {
	if r.TLS == nil || len(r.TLS.PeerCertificates) == 0 {
		return ""
	}
	return cert_fingerprint(r.TLS.PeerCertificates[0].Raw)
}

func lan_ip() string {
	for _, pair := range get_interface_broadcast_pairs(0) {
		if pair.local != nil {
			return pair.local.IP.String()
		}
	}
	return "127.0.0.1"
}

func trust_key(id string, fp string) string {
	return id + "@" + fp
}