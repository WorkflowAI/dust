use crate::{
    oauth::connection::{
        Connection, ConnectionProvider, FinalizeResult, Provider, RefreshResult,
        PROVIDER_TIMEOUT_SECONDS,
    },
    utils,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose, Engine as _};
use hyper::body::Buf;
use lazy_static::lazy_static;
use serde_json::json;
use std::env;
use std::io::prelude::*;
use std::time::Duration;
use tokio::time::timeout;

lazy_static! {
    static ref OAUTH_NOTION_CLIENT_ID: String = env::var("OAUTH_NOTION_CLIENT_ID").unwrap();
    static ref OAUTH_NOTION_CLIENT_SECRET: String = env::var("OAUTH_NOTION_CLIENT_SECRET").unwrap();
}

pub struct NotionConnectionProvider {}

impl NotionConnectionProvider {
    pub fn new() -> Self {
        NotionConnectionProvider {}
    }

    fn basic_auth(&self) -> String {
        general_purpose::STANDARD.encode(&format!(
            "{}:{}",
            *OAUTH_NOTION_CLIENT_ID, *OAUTH_NOTION_CLIENT_SECRET
        ))
    }
}

#[async_trait]
impl Provider for NotionConnectionProvider {
    fn id(&self) -> ConnectionProvider {
        ConnectionProvider::Notion
    }

    async fn finalize(
        &self,
        _connection: &Connection,
        code: &str,
        redirect_uri: &str,
    ) -> Result<FinalizeResult> {
        let body = json!({
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
        });

        let req = reqwest::Client::new()
            .post("https://api.notion.com/v1/oauth/token")
            .header("Accept", "application/json")
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Basic {}", self.basic_auth()))
            .json(&body);

        let now = utils::now_secs();

        let res = match timeout(Duration::new(PROVIDER_TIMEOUT_SECONDS, 0), req.send()).await {
            Ok(Ok(res)) => res,
            Ok(Err(e)) => Err(e)?,
            Err(_) => Err(anyhow!("Timeout sending request to Notion"))?,
        };

        if !res.status().is_success() {
            Err(anyhow!(
                "Error generating access token with Notion: status={}",
                res.status().as_u16(),
            ))?;
        }

        let body = match timeout(
            Duration::new(PROVIDER_TIMEOUT_SECONDS - (utils::now_secs() - now), 0),
            res.bytes(),
        )
        .await
        {
            Ok(Ok(body)) => body,
            Ok(Err(e)) => Err(e)?,
            Err(_) => Err(anyhow!("Timeout reading response from Notion"))?,
        };

        let mut b: Vec<u8> = vec![];
        body.reader().read_to_end(&mut b)?;
        let c: &[u8] = &b;

        let raw_json: serde_json::Value = serde_json::from_slice(c)?;

        let access_token = match raw_json["access_token"].as_str() {
            Some(token) => token,
            None => Err(anyhow!("Missing `access_token` in response from Notion"))?,
        };

        Ok(FinalizeResult {
            redirect_uri: redirect_uri.to_string(),
            code: code.to_string(),
            access_token: access_token.to_string(),
            access_token_expiry: None,
            refresh_token: None,
            raw_json,
        })
    }

    async fn refresh(&self, _connection: &Connection) -> Result<RefreshResult> {
        Err(anyhow!("Notion access tokens do not expire"))?
    }
}
