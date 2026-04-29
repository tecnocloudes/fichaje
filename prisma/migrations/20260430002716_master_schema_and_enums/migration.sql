-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "master";

-- CreateEnum
CREATE TYPE "master"."TenantStatus" AS ENUM ('pending', 'provisioning', 'active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "master"."SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused', 'incomplete', 'incomplete_expired');

-- CreateEnum
CREATE TYPE "master"."FeatureSource" AS ENUM ('plan', 'addon', 'manual_override');

-- CreateEnum
CREATE TYPE "master"."FeatureType" AS ENUM ('boolean', 'limit', 'quota');

-- CreateEnum
CREATE TYPE "master"."PlatformRol" AS ENUM ('SUPER_ADMIN', 'SUPPORT');

