package ssh

import (
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type Config struct {
	Host          string `json:"host"`
	Port          int    `json:"port"`
	Username      string `json:"username"`
	Password      string `json:"password"`
	PrivateKey    string `json:"privateKey"`
	KeyPassphrase string `json:"keyPassphrase"`
}

type Client struct {
	cfg        Config
	sshClient  *ssh.Client
	sftpClient *sftp.Client
	sftpMu     sync.Mutex
	stopCh     chan struct{}
	closeOnce  sync.Once
}

func NewClient(cfg Config) (*Client, error) {
	if cfg.Port == 0 {
		cfg.Port = 22
	}

	var authMethods []ssh.AuthMethod

	if cfg.Password != "" {
		authMethods = append(authMethods, ssh.Password(cfg.Password))
	}

	if cfg.PrivateKey != "" {
		var signer ssh.Signer
		var err error
		if cfg.KeyPassphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(cfg.PrivateKey), []byte(cfg.KeyPassphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(cfg.PrivateKey))
		}
		if err != nil {
			return nil, fmt.Errorf("failed to parse private key: %w", err)
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	}

	if len(authMethods) == 0 {
		return nil, fmt.Errorf("no authentication method provided (password or private key required)")
	}

	clientConfig := &ssh.ClientConfig{
		User:            cfg.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))
	sshClient, err := ssh.Dial("tcp", addr, clientConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to ssh server %s: %w", addr, err)
	}

	client := &Client{
		cfg:       cfg,
		sshClient: sshClient,
		stopCh:    make(chan struct{}),
	}
	client.startKeepAlive(15 * time.Second)

	return client, nil
}

func (c *Client) startKeepAlive(interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-c.stopCh:
				return
			case <-ticker.C:
				resCh := make(chan error, 1)
				go func() {
					if c.sshClient == nil {
						resCh <- fmt.Errorf("client closed")
						return
					}
					// OpenSSH keepalive request. If server doesn't support the request name,
					// it responds with failure (err == nil, ok == false), which still proves the connection is alive!
					_, _, err := c.sshClient.SendRequest("keepalive@openssh.com", true, nil)
					resCh <- err
				}()

				select {
				case <-c.stopCh:
					return
				case err := <-resCh:
					if err != nil {
						// Network connection dropped or reset
						_ = c.Close()
						return
					}
				case <-time.After(10 * time.Second):
					// Keepalive response timed out
					_ = c.Close()
					return
				}
			}
		}
	}()
}

func (c *Client) Close() error {
	c.closeOnce.Do(func() {
		if c.stopCh != nil {
			close(c.stopCh)
		}
	})

	c.sftpMu.Lock()
	if c.sftpClient != nil {
		_ = c.sftpClient.Close()
		c.sftpClient = nil
	}
	c.sftpMu.Unlock()

	if c.sshClient != nil {
		return c.sshClient.Close()
	}
	return nil
}

func (c *Client) GetSFTPClient() (*sftp.Client, error) {
	c.sftpMu.Lock()
	defer c.sftpMu.Unlock()

	if c.sftpClient != nil {
		return c.sftpClient, nil
	}
	if c.sshClient == nil {
		return nil, fmt.Errorf("ssh client not connected")
	}

	client, err := sftp.NewClient(c.sshClient)
	if err != nil {
		return nil, err
	}
	c.sftpClient = client
	return c.sftpClient, nil
}

func (c *Client) ResetSFTPClient() {
	c.sftpMu.Lock()
	defer c.sftpMu.Unlock()
	if c.sftpClient != nil {
		_ = c.sftpClient.Close()
		c.sftpClient = nil
	}
}

func (c *Client) NewSession() (*ssh.Session, error) {
	if c.sshClient == nil {
		return nil, fmt.Errorf("ssh client not connected")
	}
	return c.sshClient.NewSession()
}

func (c *Client) RawClient() *ssh.Client {
	return c.sshClient
}
