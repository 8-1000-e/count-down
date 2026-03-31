use anchor_lang::prelude::*;
use anchor_lang::system_program;
use std::str::FromStr;

declare_id!("9x4LbUPs1aKmLFdHbmop1vHyqqyvg8ngnZkjTmT8XNB7");

#[program]
pub mod count_down {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, init_bid: u64, ticket_price: u64, end_time: i64) -> Result<()> {
        let admin = Pubkey::from_str("69TwH2GJiBSA8Eo3DunPGsXGWjNFY267zRrpHptYWCuC").unwrap();
        require!(ctx.accounts.signer.key() == admin, CustomError::Unauthorized);

        let count_down = &mut ctx.accounts.count_down;
        count_down.authority = ctx.accounts.signer.key();
        count_down.init_bid = init_bid;
        count_down.ticket_price = ticket_price;
        count_down.start_time = Clock::get()?.unix_timestamp;
        count_down.end_time = end_time;
        count_down.ticket_counter = 0;
        count_down.last_ticket_buyer = ctx.accounts.signer.key();
        count_down.vault_bump = ctx.bumps.vault;
        count_down.status = AuctionStatus::Active;

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.signer.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            init_bid,
        )?;

        Ok(())
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>) -> Result<()> {
        let count_down = &mut ctx.accounts.count_down;
        let current_time = Clock::get()?.unix_timestamp;
        require!(count_down.status == AuctionStatus::Active, CustomError::AuctionEnded);
        require!(current_time < count_down.end_time, CustomError::AuctionEnded);

        let ticket_price = count_down.ticket_price;
        let half = ticket_price / 2;

        // Half to authority
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.signer.to_account_info(),
                    to: ctx.accounts.authority.to_account_info(),
                },
            ),
            half,
        )?;

        // Half to vault
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.signer.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            ticket_price - half,
        )?;

        count_down.end_time += 60;
        count_down.last_ticket_buyer = ctx.accounts.signer.key();
        count_down.ticket_counter += 1;
        Ok(())
    }

    pub fn claim_auction(ctx: Context<ClaimAuction>) -> Result<()> {
        let count_down_key = ctx.accounts.count_down.key();
        let vault_bump = ctx.accounts.count_down.vault_bump;

        let count_down = &mut ctx.accounts.count_down;
        let current_time = Clock::get()?.unix_timestamp;
        require!(count_down.status == AuctionStatus::Active, CustomError::AuctionAlreadyClaimed);
        require!(current_time >= count_down.end_time, CustomError::AuctionNotEnded);

        count_down.status = AuctionStatus::Claimed;

        let seeds: &[&[u8]] = &[
            b"vault",
            count_down_key.as_ref(),
            &[vault_bump],
        ];

        let amount = ctx.accounts.vault.lamports();

        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.signer.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        init,
        payer = signer,
        space = 8 + CountDown::INIT_SPACE,
    )]
    pub count_down: Account<'info, CountDown>,
    /// CHECK: vault PDA, validated by seeds
    #[account(
        mut,
        seeds = [b"vault", count_down.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyTicket<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut)]
    pub count_down: Account<'info, CountDown>,
    /// CHECK: validated against count_down.authority
    #[account(
        mut,
        constraint = authority.key() == count_down.authority @ CustomError::Unauthorized,
    )]
    pub authority: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [b"vault", count_down.key().as_ref()],
        bump = count_down.vault_bump,
    )]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimAuction<'info> {
    #[account(
        mut,
        constraint = signer.key() == count_down.last_ticket_buyer @ CustomError::Unauthorized,
    )]
    pub signer: Signer<'info>,
    #[account(mut)]
    pub count_down: Account<'info, CountDown>,
    #[account(
        mut,
        seeds = [b"vault", count_down.key().as_ref()],
        bump = count_down.vault_bump,
    )]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct CountDown {
    pub authority: Pubkey,
    pub init_bid: u64,
    pub ticket_price: u64,
    pub start_time: i64,
    pub end_time: i64,
    pub ticket_counter: u64,
    pub last_ticket_buyer: Pubkey,
    pub vault_bump: u8,
    pub status: AuctionStatus,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AuctionStatus {
    Active,
    Claimed,
}

#[error_code]
pub enum CustomError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Auction has ended")]
    AuctionEnded,
    #[msg("Auction has not ended yet")]
    AuctionNotEnded,
    #[msg("Auction has already been claimed")]
    AuctionAlreadyClaimed,
}
